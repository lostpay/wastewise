import datetime
import re

from wastewise.models import WeatherInfo, SupplierPrice, AdjustedItem, POLine
from wastewise.pipeline import run_forecast, run_sourcing, run_rationale


class _Weather:
    def __init__(self):
        self.calls = 0

    def get_weather(self, date, location):
        self.calls += 1
        return WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)


class _Holidays:
    def __init__(self):
        self.calls = []

    def get_holidays(self, start, end):
        self.calls.append((start, end))
        return []


class _LLM:
    def complete(self, system, user): return "note"


def test_run_forecast_returns_adjusted_items(sample_sales):
    holidays = _Holidays()
    weather = _Weather()
    resp = run_forecast(sample_sales, 7, "40.7,-74.0", weather, holidays, _LLM())
    assert {i.item for i in resp.items} == {"cabbage", "pork"}
    assert 0.0 <= resp.baseline_delta <= 1.0
    assert resp.waste_avoided_units >= 0.0
    assert weather.calls == 7
    # holiday window must cover the sales history, not just the future horizon
    start, end = holidays.calls[0]
    assert start == min(r.date for r in sample_sales)
    assert end == max(r.date for r in sample_sales) + datetime.timedelta(days=7)


def test_run_forecast_ai_waste_avoided_is_none_without_price_column(sample_sales):
    # _LLM.complete always returns invalid JSON, so every item falls back to
    # its unadjusted recommended qty -- units stay at 0, and since sample_sales
    # carries no price data the dollar figure must be None, not 0.0.
    resp = run_forecast(sample_sales, 7, "40.7,-74.0", _Weather(), _Holidays(), _LLM())
    assert resp.ai_waste_avoided_value is None
    assert resp.ai_waste_avoided_units == 0.0


class _LoweringLLM:
    """Nudges every item's recommended qty down by exactly 10% -- within the
    +/-40% hard cap, so the resulting delta is exactly computable."""
    def complete(self, system, user):
        # `[\d.]+` would also swallow the sentence-ending period after the
        # number ("recommended quantity: 204.44."), so match digits with at
        # most one internal decimal point instead.
        rec = float(re.search(r"recommended quantity: (\d+(?:\.\d+)?)", user).group(1))
        return f'{{"adjusted_qty": {rec * 0.9}, "reason": "test nudge down."}}'


def test_run_forecast_ai_waste_avoided_sums_downward_nudges_at_mean_price(sample_sales):
    priced = [r.model_copy(update={"price": 2.0}) for r in sample_sales]
    resp = run_forecast(priced, 7, "40.7,-74.0", _Weather(), _Holidays(), _LoweringLLM())
    delta_units = sum(max(0.0, i.recommended - i.adjusted_qty) for i in resp.items)
    assert delta_units > 0  # sanity: the stub LLM really did nudge every item down
    assert resp.ai_waste_avoided_units == round(delta_units, 2)
    # every record was priced at a flat $2.00, so the mean price per item is $2.00
    assert resp.ai_waste_avoided_value == round(delta_units * 2.0, 2)


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.0)]


def test_run_sourcing_wraps_source_order():
    resp = run_sourcing([{"item": "cabbage", "qty": 3}], "loc",
                        _Wholesale(), _Retail(), _LLM())
    assert resp.total == 3.0


def test_run_rationale_wraps_write_rationale():
    items = [AdjustedItem(item="cabbage", forecast=100, adjusted_qty=90,
                          reason="Rain lowers demand.", live=True)]
    lines = [POLine(item="cabbage", qty=90, supplier="Kroger", unit_price=1.4,
                    line_total=126.0, note="30% under benchmark.", live=True)]
    resp = run_rationale(items, lines, 10.0, 126.0, _LLM())
    assert resp.live is True
    assert resp.paragraph == "note"  # _LLM.complete always returns "note"
