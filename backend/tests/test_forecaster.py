# tests/test_forecaster.py
import datetime

from wastewise.forecasting.forecaster import build_frame, forecast_items
from wastewise.models import ForecastItem


def test_build_frame_has_features(sample_sales):
    df = build_frame(sample_sales)
    for col in ["dow", "weekofyear", "month", "lag7", "roll7", "item_code", "is_holiday"]:
        assert col in df.columns


def test_item_codes_distinguish_items(sample_sales):
    df = build_frame(sample_sales)
    assert (df.groupby("item")["item_code"].nunique() == 1).all()
    assert df["item_code"].nunique() == 2


def test_holiday_flag_marks_holiday_dates(sample_sales):
    memorial_day = datetime.date(2026, 5, 25)
    df = build_frame(sample_sales, frozenset({memorial_day}))
    flagged = set(df[df["is_holiday"] == 1]["date"].dt.date)
    assert flagged == {memorial_day}
    assert (df[df["is_holiday"] == 0]["date"].dt.date != memorial_day).all()


def test_forecast_items_returns_item_per_product(sample_sales):
    items, stats = forecast_items(sample_sales, horizon_days=7)
    names = {i.item for i in items}
    assert names == {"cabbage", "pork"}
    for it in items:
        assert isinstance(it, ForecastItem)
        assert it.forecast >= 0
        # recommended = forecast + 15% buffer
        assert abs(it.recommended_purchase_qty - it.forecast * 1.15) < 1e-6
    assert 0.0 <= stats.delta <= 1.0


def test_backtest_reports_waste_avoided_units(sample_sales):
    _, stats = forecast_items(sample_sales, horizon_days=7)
    assert stats.waste_avoided_units >= 0.0
    assert stats.waste_avoided_value is None  # sample_sales has no prices


def test_waste_avoided_value_present_when_prices_exist(sample_sales):
    priced = [r.model_copy(update={"price": 2.0}) for r in sample_sales]
    _, stats = forecast_items(priced, horizon_days=7)
    assert stats.waste_avoided_value is not None
    assert stats.waste_avoided_value >= 0.0


def test_forecast_items_include_daily_series(sample_sales):
    items, _ = forecast_items(sample_sales, horizon_days=7)
    for it in items:
        assert len(it.daily) == 7
        assert all(d >= 0 for d in it.daily)


def test_buffer_fracs_override_flat_safety_buffer():
    import datetime
    from wastewise.models import SalesRecord
    from wastewise.forecasting.forecaster import forecast_items
    records = [SalesRecord(date=datetime.date(2026, 1, 1) + datetime.timedelta(days=i),
                           item="rice", quantity=10 + (i % 3))
               for i in range(60)]
    items, _ = forecast_items(records, 7, buffer_fracs={"rice": 0.05})
    it = items[0]
    assert abs(it.safety_buffer - 0.05 * it.forecast) < 0.05
    # forecast/buffer are rounded independently, so allow a cent of drift.
    assert abs(it.recommended_purchase_qty - (it.forecast + it.safety_buffer)) < 0.05
