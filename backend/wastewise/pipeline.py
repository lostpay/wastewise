import datetime
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale

_HORIZON = {"day": 1, "week": 7}


def run_forecast(records: list[SalesRecord], horizon: str, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
    horizon_days = _HORIZON[horizon]
    items, delta = forecast_items(records, horizon_days)
    last_day = max(r.date for r in records)
    first_future = last_day + datetime.timedelta(days=1)
    weather = weather_src.get_weather(first_future, location)
    holidays = holiday_src.get_holidays(
        first_future, last_day + datetime.timedelta(days=horizon_days))
    adjusted = adjust_forecast(items, weather, holidays, llm)
    return ForecastResponse(items=adjusted, baseline_delta=delta)


def run_sourcing(items: list[dict], location: str, wholesale_src, retail_src,
                 llm) -> SourcingResponse:
    return source_order(items, wholesale_src, retail_src, llm, location)


def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
