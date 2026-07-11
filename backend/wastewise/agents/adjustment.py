import datetime
import sys
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday
from wastewise.agents.llm import extract_json

MAX_ADJUST_FRAC = 0.25

SYSTEM = (
    "You are a restaurant purchasing assistant. You are given ONE item's "
    "recommended purchase quantity (which already includes a safety buffer) "
    "plus the day-by-day weather for the purchasing horizon and its holidays. "
    "Decide whether the weather pattern or a holiday is a clear, UNUSUAL "
    "demand signal for THIS item's category. Mild or seasonal weather is NOT "
    "a signal: in that case return the quantity UNCHANGED and say why no "
    "adjustment is needed. Adjust only for pronounced signals (sustained "
    "rain, a heat wave, a cold snap, a holiday), never by more than 25% in "
    "either direction, and give a one-sentence item-specific reason. The "
    "same weather affects different item categories differently -- never "
    "reuse a generic reason across items.\n\n"
    "Examples of the differentiation expected:\n"
    "- Rain all week, item 'beef stew' (hot/comfort food): demand goes UP -> "
    '{"adjusted_qty": 115, "reason": "Sustained rain drives comfort-food '
    'orders like stew up."}\n'
    "- Rain all week, item 'mixed salad greens' (cold/perishable): demand "
    'goes DOWN as dine-in traffic drops -> {"adjusted_qty": 80, "reason": '
    '"Rain lowers dine-in demand for cold salad items."}\n'
    "- Holiday (e.g. Thanksgiving), item 'turkey' (bulk/gathering item): "
    'demand goes UP -> {"adjusted_qty": 120, "reason": "Thanksgiving drives '
    'bulk turkey purchases for gatherings."}\n'
    "- Mild 22C, partly cloudy week, item 'rice' (shelf-stable staple): no "
    'clear signal -> {"adjusted_qty": 100, "reason": "Unremarkable weather '
    'for the season; no adjustment needed for a shelf-stable staple."}\n\n'
    'Respond ONLY with JSON: {"adjusted_qty": number, "reason": str}. '
    "Reply in English."
)

FALLBACK_REASON = "AI reasoning unavailable — using base forecast."


def _weather_text(weather: list[tuple[datetime.date, WeatherInfo]]) -> str:
    return "; ".join(
        f"{d.strftime('%a %b %d')}: {w.condition}, {w.temp_c}C, precip {w.precipitation_mm}mm"
        for d, w in weather)


def _adjust_one(item: ForecastItem, weather_txt: str, holiday_txt: str, llm) -> AdjustedItem:
    rec = item.recommended_purchase_qty
    user = (f"Weather: {weather_txt}. Holidays: {holiday_txt}.\n"
            f"Item: {item.item}, recommended quantity: {rec}.")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        adjusted_qty = float(parsed["adjusted_qty"])
        reason = str(parsed["reason"]).strip()
        if not reason:
            raise ValueError("empty reason")
        # Hard cap: a hallucinated number must never move an order more than
        # +/-25% away from the buffered recommendation.
        lo, hi = rec * (1 - MAX_ADJUST_FRAC), rec * (1 + MAX_ADJUST_FRAC)
        adjusted_qty = round(min(max(adjusted_qty, lo), hi), 2)
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=adjusted_qty, reason=reason, live=True,
                            daily=item.daily, recommended=rec)
    except Exception as e:
        print(f"[adjustment] LLM call failed for {item.item!r}: "
              f"{type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=rec,
                            reason=FALLBACK_REASON, live=False, daily=item.daily,
                            recommended=rec)


def adjust_forecast(items: list[ForecastItem],
                    weather: list[tuple[datetime.date, WeatherInfo]],
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"
    weather_txt = _weather_text(weather)

    def _adjust_one_partial(item):
        return _adjust_one(item, weather_txt, holiday_txt, llm)

    # One call per item, run concurrently -- each item only sees its own name
    # and quantity, so the model structurally cannot copy-paste reasoning
    # across items regardless of prompt wording (see SYSTEM above).
    with ThreadPoolExecutor(max_workers=min(3, len(items)) or 1) as pool:
        return list(pool.map(_adjust_one_partial, items))
