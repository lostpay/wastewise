import datetime
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items, mean_prices
from wastewise.agents.adjustment import adjust_forecast, summarize_adjustments
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale
from wastewise.agents.spoilage import assess_spoilage, BUFFER_BY_RISK

def run_forecast(records: list[SalesRecord], horizon_days: int, location: str,
                 weather_src, holiday_src, llm,
                 currency: str = "USD") -> ForecastResponse:
    first_hist = min(r.date for r in records)
    last_day = max(r.date for r in records)
    first_future = last_day + datetime.timedelta(days=1)
    horizon_end = last_day + datetime.timedelta(days=horizon_days)
    # Holidays span the full history so the model can learn from past holiday
    # spikes, not just flag the upcoming ones.
    holidays = holiday_src.get_holidays(first_hist, horizon_end)
    holiday_dates = frozenset(h.date for h in holidays)
    item_names = sorted({r.item for r in records})
    spoilage = assess_spoilage(item_names, llm)
    buffer_fracs = {n: BUFFER_BY_RISK[s.risk] for n, s in spoilage.items()}
    items, stats = forecast_items(records, horizon_days, holiday_dates=holiday_dates,
                                  buffer_fracs=buffer_fracs, currency=currency)
    weather = [(first_future + datetime.timedelta(days=i),
                weather_src.get_weather(first_future + datetime.timedelta(days=i), location))
               for i in range(horizon_days)]
    future_holidays = [h for h in holidays if h.date >= first_future]
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    for a in adjusted:
        info = spoilage.get(a.item)
        if info and info.live:
            a.spoilage_risk = info.risk
            a.shelf_life_days = info.shelf_life_days
    # Projected AI-avoided waste on the current horizon: for each item,
    # count only downward LLM nudges (raising a qty is the LLM saying "you
    # need more" -- not waste). Sum in units always; in USD when the CSV
    # carries a price column.
    prices = mean_prices(records, currency)
    ai_units = sum(max(0.0, a.recommended - a.adjusted_qty) for a in adjusted)
    ai_value = None
    if prices:
        ai_value = round(
            sum(max(0.0, a.recommended - a.adjusted_qty) * prices.get(a.item, 0.0)
                for a in adjusted), 2)
    return ForecastResponse(items=adjusted, baseline_delta=stats.delta,
                            waste_avoided_units=stats.waste_avoided_units,
                            waste_avoided_value=stats.waste_avoided_value,
                            adjustment=summarize_adjustments(adjusted),
                            holdout_daily=stats.holdout_daily,
                            ai_waste_avoided_units=round(ai_units, 2),
                            ai_waste_avoided_value=ai_value)


def run_sourcing(items: list[dict], location: str, wholesale_src, retail_src,
                 llm, historical_items: set[str] | None = None) -> SourcingResponse:
    return source_order(items, wholesale_src, retail_src, llm, location,
                        historical_items=historical_items)


def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
