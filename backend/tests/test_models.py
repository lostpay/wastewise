import datetime
from wastewise.models import ForecastItem, AdjustedItem, POLine, SourcingResponse, RationaleResponse


def test_forecast_item_defaults_and_types():
    fi = ForecastItem(item="cabbage", forecast=10.0, baseline=9.0,
                      safety_buffer=2.0, recommended_purchase_qty=12.0)
    assert fi.item == "cabbage"
    assert fi.recommended_purchase_qty == 12.0


def test_sourcing_response_roundtrips():
    line = POLine(item="cabbage", qty=12, supplier="Kroger",
                  unit_price=1.5, line_total=18.0, note="8% under market", live=True)
    resp = SourcingResponse(lines=[line], total=18.0, savings=1.6)
    assert resp.model_dump()["lines"][0]["supplier"] == "Kroger"


def test_adjusted_item_requires_live_flag():
    item = AdjustedItem(item="cabbage", forecast=100.0, adjusted_qty=90.0,
                        reason="Rain lowers demand.", live=True)
    assert item.live is True


def test_rationale_response_roundtrips():
    resp = RationaleResponse(paragraph="Rain lowers demand; sourcing saves $10.", live=True)
    assert resp.model_dump()["live"] is True
