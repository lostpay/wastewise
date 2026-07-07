# tests/test_forecaster.py
from wastewise.forecasting.forecaster import build_frame, forecast_items
from wastewise.models import ForecastItem


def test_build_frame_has_features(sample_sales):
    df = build_frame(sample_sales)
    for col in ["dow", "weekofyear", "month", "lag7", "roll7"]:
        assert col in df.columns


def test_forecast_items_returns_item_per_product(sample_sales):
    items, delta = forecast_items(sample_sales, horizon_days=7)
    names = {i.item for i in items}
    assert names == {"cabbage", "pork"}
    for it in items:
        assert isinstance(it, ForecastItem)
        assert it.forecast >= 0
        # recommended = forecast + 15% buffer
        assert abs(it.recommended_purchase_qty - it.forecast * 1.15) < 1e-6
    assert 0.0 <= delta <= 1.0
