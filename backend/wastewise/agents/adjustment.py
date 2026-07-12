import datetime
import sys
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday, AdjustmentSummary
from wastewise.agents.llm import extract_json

MAX_ADJUST_FRAC = 0.40

SYSTEM = (
    "You are a purchasing assistant for a SIT-DOWN RESTAURANT. You are NOT "
    "advising a household or a grocery store. Your ONLY question is: will "
    "the restaurant sell more or fewer meals over the horizon? Never reason "
    "about what customers cook, bake, or eat at home.\n\n"
    "The chain of causation you MUST follow, in this order:\n\n"
    "  weather / holidays  ->  dine-in foot traffic (customers walking in)\n"
    "                     ->  restaurant meals sold\n"
    "                     ->  how much of THIS ingredient the kitchen needs\n\n"
    "Foot traffic is the primary lever. Almost every weather effect on a "
    "restaurant's ingredient needs runs through this one channel: fewer "
    "people leave the house -> fewer plates served -> less of every "
    "ingredient used. Item-specific effects are always second-order.\n\n"
    "HARDCODED STARTING POINTS. Apply the traffic effect FIRST, then let "
    "item-specific reasoning shift it slightly (never reverse it):\n\n"
    "- Typhoon or severe storm expected to shut down transit for a day: "
    "START from -40% -- the largest cut the system allows. The city "
    "stops; order the least the safety cap permits.\n"
    "- Sustained heavy rain most of the horizon: START from -25%.\n"
    "- Light rain / drizzle a couple of days: START from -5%.\n"
    "- Heat wave (sustained >35C / 95F): START from -15%. Customers stay "
    "in AC at home; the ones who do come lean toward cold, light items.\n"
    "- Cold snap (sustained <0C / 32F in a normally warm climate): START "
    "from -10%. Similar traffic drop; remaining customers lean hot.\n"
    "- Public holidays where locals eat at HOME with family (Thanksgiving, "
    "Christmas Eve, Lunar New Year Eve, Dragon Boat, Mid-Autumn, Diwali): "
    "START from -35%. No item is exempt.\n"
    "- Public holidays where dining OUT is the tradition (Valentine's Day, "
    "Mother's Day, Father's Day, New Year's Eve): START from +30%.\n"
    "- Mild, unremarkable weather with no holidays: START from 0 (return "
    "the quantity UNCHANGED, do NOT invent a signal).\n\n"
    "ITEM-SPECIFIC OFFSETS. Only a NARROW set of items get any offset. "
    "Even when they do, the offset can add back at most +15 percentage "
    "points toward zero, never past it:\n\n"
    "- Under sustained rain or cold snap: hot soups, hot noodles, heavy "
    "stews, and hot pot ingredients get +15 pp offset. Example: a stew "
    "ingredient starting at -25% ends at -10% (still down, just less).\n"
    "- Under a heat wave: cold salads, cold noodles, iced desserts, fresh "
    "juices get +15 pp offset. Example: cold salad greens starting at "
    "-15% end at 0 (roughly flat, not up).\n"
    "- Under family-home holidays: NO offset. Everyone stays home; even "
    "comfort ingredients go DOWN with everything else.\n"
    "- Under dining-out holidays: upscale items (steak, seafood, paneer, "
    "mutton, wagyu) get +5 pp EXTRA on top of the +30% start. Staples "
    "(rice, sugar, milk, salt) stay at the +30% baseline.\n\n"
    "WHAT NEVER TO DO:\n\n"
    "- Never say 'people bake more at home', 'families cook more', or "
    "'home cooking rises.' A restaurant's demand is about restaurant "
    "foot traffic, never home cooking.\n"
    "- Never nudge an item UP during heavy rain, cold snap, or heat wave "
    "unless it matches the narrow dish lists above -- and even then, "
    "the maximum uplift toward the offset is +15 pp, so the item still "
    "never goes above 0 during bad weather.\n"
    "- Never reuse a reason across items. Each item gets a unique "
    "one-sentence explanation that mentions the item name.\n"
    "- Never make up weather patterns not present in the input.\n\n"
    "You are given ONE item, plus the day-by-day weather and holidays for "
    "the horizon, plus the buffered recommended quantity. Apply the "
    "starting point + item-specific offset, cap the total delta at +/-40% "
    "of the recommended, and return a one-sentence RESTAURANT-framed "
    "reason.\n\n"
    "Examples (note every reason talks about restaurant demand, and rain "
    "examples all end up DOWN):\n\n"
    "- Sustained heavy rain, item 'eggs' (used across breakfast + general "
    'prep): {"adjusted_qty": 75, "reason": "Sustained rain cuts breakfast '
    'foot traffic; kitchen will use fewer eggs across the menu."}\n'
    "- Sustained heavy rain, item 'beef stew' (hot comfort dish): "
    '{"adjusted_qty": 90, "reason": "Rain drops overall traffic; the '
    "remaining diners lean toward hot stews, softening the drop for this "
    'ingredient but not reversing it."}\n'
    "- Sustained heavy rain, item 'mixed salad greens' (cold appetizer): "
    '{"adjusted_qty": 70, "reason": "Rain both cuts traffic and shifts the '
    'remaining diners away from cold salads; largest drop of any item."}\n'
    "- Heat wave, item 'mixed salad greens': "
    '{"adjusted_qty": 100, "reason": "Heat wave cuts overall dine-in, but '
    "the remaining customers lean toward cold salads; roughly flat for "
    'salad greens."}\n'
    "- Thanksgiving Thursday in the horizon, item 'turkey' (US sit-down "
    'restaurant): {"adjusted_qty": 65, "reason": "Thanksgiving pulls diners '
    'to family tables at home; restaurant turkey plates drop, not rise."}\n'
    "- Valentine's Day in the horizon, item 'steak' (upscale): "
    '{"adjusted_qty": 135, "reason": "Valentine\'s Day drives dine-out '
    'demand for upscale items like steak."}\n'
    "- Mild 22C partly cloudy week, no holidays, item 'rice': "
    '{"adjusted_qty": 100, "reason": "Unremarkable weather and no holidays; '
    'no restaurant demand signal for rice."}\n\n'
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
        # +/-MAX_ADJUST_FRAC (40%) away from the buffered recommendation.
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


def summarize_adjustments(adjusted: list[AdjustedItem]) -> AdjustmentSummary:
    n_up = sum(1 for a in adjusted if a.adjusted_qty > a.recommended)
    n_down = sum(1 for a in adjusted if a.adjusted_qty < a.recommended)
    rec_sum = sum(a.recommended for a in adjusted)
    net = 0.0 if rec_sum == 0 else \
        (sum(a.adjusted_qty for a in adjusted) - rec_sum) / rec_sum * 100
    return AdjustmentSummary(n_up=n_up, n_down=n_down,
                             n_unchanged=len(adjusted) - n_up - n_down,
                             net_delta_pct=round(net, 1))
