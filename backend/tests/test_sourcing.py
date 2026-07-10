# tests/test_sourcing.py
import json
from wastewise.models import SupplierPrice
from wastewise.agents.sourcing import source_order, NO_BENCHMARK_NOTE, NO_MATCH_NOTE


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
    assert line.live is False  # _FakeLLM's reply isn't valid selection JSON


def test_source_order_excludes_historical_items_from_savings():
    # Same setup as the picks-cheapest test, but marks the item as backed by
    # the historical fallback. Savings should stay $0 because comparing a
    # historical-average benchmark to a real Kroger price is not a real
    # market saving (and used to inflate savings for non-USD CSVs).
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc",
                        historical_items={"cabbage"})
    assert resp.lines[0].line_total == 15.0
    assert resp.total == 15.0
    assert resp.savings == 0.0
    # Historical items get benchmark=None so the frontend can render "—" and
    # avoid claiming a US retail comparison it doesn't actually have.
    assert resp.lines[0].benchmark is None


def test_source_order_exposes_the_us_benchmark_on_each_line():
    # Non-historical items expose their real FRED benchmark on the POLine so
    # the frontend can show it alongside the Kroger price.
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc")
    assert resp.lines[0].benchmark == 2.0


class _NoRetail:
    def get_retail_prices(self, item, location): return []


def test_source_order_falls_back_to_market_when_no_retail():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0
    assert resp.lines[0].live is False


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("simulated LLM outage")


def test_source_order_fallback_note_uses_retail_average_language():
    # _Wholesale benchmark is 2.0, no retail offer, so unit_price falls back
    # to the benchmark itself (Market fallback) -- the note reflects that
    # 2.0 == 2.0 as "at or above".
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _RaisingLLM(), "loc")
    assert resp.lines[0].note == "$2.00 vs. US avg $2.00 (at or above)."
    assert resp.lines[0].live is False


class _NoWholesale:
    def get_wholesale_price(self, item): return None


def test_source_order_no_benchmark_note_is_honest_not_misleading():
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _NoWholesale(), _Retail(), _FakeLLM(), "loc")
    assert resp.lines[0].note == NO_BENCHMARK_NOTE


def test_source_order_no_retail_and_no_benchmark_is_honest_zero():
    resp = source_order([{"item": "mutton", "qty": 5}],
                        _NoWholesale(), _NoRetail(), _FakeLLM(), "loc")
    line = resp.lines[0]
    assert line.supplier == "No price data"
    assert line.unit_price == 0.0
    assert line.note == NO_MATCH_NOTE
    assert line.live is False


def test_source_order_still_falls_back_to_market_when_benchmark_exists():
    # Regression guard: no retail offers but a real benchmark still prices
    # at the benchmark, not $0 -- this behavior must not change.
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0


class _MultiRetail:
    def get_retail_prices(self, item, location):
        return [
            SupplierPrice(supplier="Kroger", unit_price=10.0,
                         description="Private Selection Marinated Chicken Thighs"),
            SupplierPrice(supplier="Kroger", unit_price=4.5,
                         description="Kroger Chicken Breast"),
        ]


class _SelectingLLM:
    """Simulates the model picking the plain (index 1) option over the
    marinated one, and explaining why."""
    def complete(self, system, user):
        return json.dumps({"index": 1, "reason": "Plain cut, well under benchmark."})


def test_source_order_uses_llm_to_pick_best_candidate_not_just_cheapest_index0():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _SelectingLLM(), "loc")
    line = resp.lines[0]
    assert line.unit_price == 4.5
    assert line.note == "Plain cut, well under benchmark."
    assert line.live is True


class _MalformedLLM:
    def complete(self, system, user):
        return "not json at all"


def test_source_order_falls_back_to_cheapest_when_llm_output_unusable():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _MalformedLLM(), "loc")
    line = resp.lines[0]
    assert line.unit_price == 4.5  # still the cheapest candidate
    # _Wholesale's benchmark (2.0) is below the cheapest candidate (4.5), so the
    # deterministic fallback note is honestly "at or above", not "under".
    assert line.note == "$4.50 vs. US avg $2.00 (at or above)."
    assert line.live is False


class _OutOfRangeLLM:
    def complete(self, system, user):
        return json.dumps({"index": 99, "reason": "bad index"})


def test_source_order_falls_back_when_llm_picks_out_of_range_index():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _OutOfRangeLLM(), "loc")
    assert resp.lines[0].unit_price == 4.5
    assert resp.lines[0].live is False


def test_po_line_carries_offer_unit():
    class _Wholesale:
        def get_wholesale_price(self, item): return None

    class _Retail:
        def get_retail_prices(self, item, location):
            return [SupplierPrice(supplier="Kroger", unit_price=1.0,
                                  description="Green Cabbage", unit="1 lb")]

    class _BadLLM:
        def complete(self, system, user): return "not json"

    resp = source_order([{"item": "cabbage", "qty": 3}],
                        _Wholesale(), _Retail(), _BadLLM(), "40.7,-74.0")
    assert resp.lines[0].unit == "1 lb"
