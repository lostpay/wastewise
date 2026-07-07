import datetime
import statistics
from wastewise.models import SalesRecord


def baseline_forecast(records: list[SalesRecord], item: str, horizon_days: int) -> float:
    """Sum, over the next horizon_days, of the historical mean demand for that weekday."""
    hist = [r for r in records if r.item == item]
    if not hist:
        return 0.0
    by_weekday: dict[int, list[float]] = {}
    for r in hist:
        by_weekday.setdefault(r.date.weekday(), []).append(r.quantity)
    weekday_mean = {wd: statistics.fmean(v) for wd, v in by_weekday.items()}
    overall = statistics.fmean([r.quantity for r in hist])
    last_day = max(r.date for r in hist)
    total = 0.0
    for i in range(1, horizon_days + 1):
        future = last_day + datetime.timedelta(days=i)
        total += weekday_mean.get(future.weekday(), overall)
    return total
