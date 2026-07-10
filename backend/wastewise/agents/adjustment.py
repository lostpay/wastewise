from concurrent.futures import ThreadPoolExecutor

from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing assistant. You are given ONE item's "
    "recommended purchase quantity plus the day's weather and holidays. "
    "Adjust the quantity up or down based on how weather and holidays "
    "specifically affect THIS item's category, and give a one-sentence "
    "reason. The same weather condition affects different item categories "
    "differently -- never reuse a generic reason across items.\n\n"
    "Examples of the differentiation expected:\n"
    "- Rain, item 'beef stew' (hot/comfort food): demand goes UP on rainy "
    'days -> {"adjusted_qty": 145, "reason": "Rain drives comfort-food '
    'orders like stew up."}\n'
    "- Rain, item 'mixed salad greens' (cold/perishable): demand goes DOWN "
    'as dine-in traffic drops -> {"adjusted_qty": 80, "reason": "Rain '
    'lowers dine-in demand for cold salad items."}\n'
    "- Holiday (e.g. Thanksgiving), item 'turkey' (bulk/gathering item): "
    'demand goes UP for large-format group-meal items -> {"adjusted_qty": '
    '220, "reason": "Thanksgiving drives bulk turkey purchases for '
    'gatherings."}\n\n'
    'Respond ONLY with JSON: {"adjusted_qty": number, "reason": str}. '
    "Reply in English."
)

FALLBACK_REASON = "AI reasoning unavailable — using base forecast."


def _adjust_one(item: ForecastItem, weather: WeatherInfo, holiday_txt: str, llm) -> AdjustedItem:
    user = (f"Weather: {weather.condition}, {weather.temp_c}C, "
            f"precip {weather.precipitation_mm}mm. Holidays: {holiday_txt}.\n"
            f"Item: {item.item}, recommended quantity: {item.recommended_purchase_qty}.")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        adjusted_qty = float(parsed["adjusted_qty"])
        reason = str(parsed["reason"]).strip()
        if not reason:
            raise ValueError("empty reason")
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=adjusted_qty, reason=reason, live=True)
    except Exception:
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=item.recommended_purchase_qty,
                            reason=FALLBACK_REASON, live=False)


def adjust_forecast(items: list[ForecastItem], weather: WeatherInfo,
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"

    def _adjust_one_partial(item):
        return _adjust_one(item, weather, holiday_txt, llm)

    # One call per item, run concurrently -- each item only sees its own name
    # and quantity, so the model structurally cannot copy-paste reasoning
    # across items regardless of prompt wording (see SYSTEM above).
    with ThreadPoolExecutor(max_workers=min(8, len(items)) or 1) as pool:
        return list(pool.map(_adjust_one_partial, items))
