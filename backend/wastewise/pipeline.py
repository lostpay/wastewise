import datetime
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale

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
    items, stats = forecast_items(records, horizon_days,
                                  holiday_dates=holiday_dates,
                                  currency=currency)
    weather = [(first_future + datetime.timedelta(days=i),
                weather_src.get_weather(first_future + datetime.timedelta(days=i), location))
               for i in range(horizon_days)]
    future_holidays = [h for h in holidays if h.date >= first_future]
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    return ForecastResponse(items=adjusted, baseline_delta=stats.delta,
                            waste_avoided_units=stats.waste_avoided_units,
                            waste_avoided_value=stats.waste_avoided_value)


def run_sourcing(items: list[dict], location: str, wholesale_src, retail_src,
                 llm, historical_items: set[str] | None = None) -> SourcingResponse:
    return source_order(items, wholesale_src, retail_src, llm, location,
                        historical_items=historical_items)


def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
