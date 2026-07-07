from wastewise.models import WeatherInfo, SupplierPrice
from wastewise.pipeline import run_forecast, run_sourcing


class _Weather:
    def get_weather(self, date, location):
        return WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)


class _Holidays:
    def get_holidays(self, start, end): return []


class _LLM:
    def complete(self, system, user): return "note"


def test_run_forecast_returns_adjusted_items(sample_sales):
    resp = run_forecast(sample_sales, "week", "40.7,-74.0", _Weather(), _Holidays(), _LLM())
    assert {i.item for i in resp.items} == {"cabbage", "pork"}
    assert 0.0 <= resp.baseline_delta <= 1.0


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.0)]


def test_run_sourcing_wraps_source_order():
    resp = run_sourcing([{"item": "cabbage", "qty": 3}], "loc",
                        _Wholesale(), _Retail(), _LLM())
    assert resp.total == 3.0
