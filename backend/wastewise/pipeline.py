import datetime
from statistics import fmean
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale


def _location_signal(weather) -> tuple[bool, float, str, float]:
    """Summarize whether a location's weather is meaningful enough to matter.

    The core sales model is still trained from sales history only. This signal
    lets the app decide whether location should affect the final recommendation
    through weather-driven adjustment.
    """
    if not weather:
        return False, 0.0, "No weather data was available, so location was ignored.", 1.0
    temps = [w.temp_c for _, w in weather if w.condition != "unknown"]
    precs = [w.precipitation_mm for _, w in weather if w.condition != "unknown"]
    if not temps:
        return False, 0.0, "Weather was neutral, so location was ignored.", 1.0
    rainy_days = sum(
        1 for _, w in weather
        if w.precipitation_mm > 0.5 or any(word in w.condition.lower() for word in ("rain", "storm", "snow", "drizzle"))
    )
    avg_temp = fmean(temps)
    avg_precip = fmean(precs) if precs else 0.0
    temp_span = max(temps) - min(temps)
    signal = min(1.0, (rainy_days / max(1, len(weather))) * 0.5 + min(avg_precip / 20.0, 0.3) + min(temp_span / 20.0, 0.2))
    if signal < 0.15:
        return False, round(signal, 3), (
            "Weather differences were too small to materially change the forecast, "
            "so location was ignored."
        ), 1.0
    # A slightly larger signal means we keep the location-aware weather effect
    # and apply a conservative buffer to reflect the stronger uncertainty.
    buffer_multiplier = 1.0 + min(0.08, signal * 0.06)
    reason = (
        f"Weather signal is material (avg temp {avg_temp:.1f}C, precip {avg_precip:.1f}mm), "
        "so location is being considered."
    )
    return True, round(signal, 3), reason, round(buffer_multiplier, 4)

def run_forecast(records: list[SalesRecord], horizon_days: int, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
    first_hist = min(r.date for r in records)
    last_day = max(r.date for r in records)
    first_future = last_day + datetime.timedelta(days=1)
    horizon_end = last_day + datetime.timedelta(days=horizon_days)
    # Holidays span the full history so the model can learn from past holiday
    # spikes, not just flag the upcoming ones.
    holidays = holiday_src.get_holidays(first_hist, horizon_end)
    holiday_dates = frozenset(h.date for h in holidays)
    items, stats = forecast_items(records, horizon_days, holiday_dates=holiday_dates)
    weather = [(first_future + datetime.timedelta(days=i),
                weather_src.get_weather(first_future + datetime.timedelta(days=i), location))
               for i in range(horizon_days)]
    future_holidays = [h for h in holidays if h.date >= first_future]
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    location_considered, location_signal, location_reason, buffer_multiplier = _location_signal(weather)
    if location_considered:
        for item in adjusted:
            item.adjusted_qty = round(item.adjusted_qty * buffer_multiplier, 2)
    return ForecastResponse(items=adjusted, baseline_delta=stats.delta,
                            waste_avoided_units=stats.waste_avoided_units,
                            waste_avoided_value=stats.waste_avoided_value,
                            location_considered=location_considered,
                            location_signal=location_signal,
                            location_reason=location_reason)


def run_sourcing(items: list[dict], location: str, wholesale_src, retail_src,
                 llm, historical_items: set[str] | None = None) -> SourcingResponse:
    return source_order(items, wholesale_src, retail_src, llm, location,
                        historical_items=historical_items)


def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
