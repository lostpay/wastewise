# tests/test_sourcing.py
from wastewise.models import SupplierPrice
from wastewise.agents.sourcing import source_order


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.5)]


class _FakeLLM:
    def complete(self, system, user): return "Kroger is below market."


def test_source_order_picks_cheapest_and_computes_savings():
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc")
    line = resp.lines[0]
    assert line.supplier == "Kroger"
    assert line.unit_price == 1.5
    assert line.line_total == 15.0
    assert resp.total == 15.0
    assert resp.savings == 5.0  # (2.0-1.5)*10


class _NoRetail:
    def get_retail_prices(self, item, location): return []


def test_source_order_falls_back_to_market_when_no_retail():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("simulated LLM outage")


def test_source_order_fallback_note_uses_retail_average_language():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _RaisingLLM(), "loc")
    assert resp.lines[0].note == "At or above the US retail average."
