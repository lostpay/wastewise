import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_usda import USDAWholesale

BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports/2315"


@respx.mock
def test_get_wholesale_price_averages(tmp_path):
    body = {"results": [{"commodity": "CABBAGE", "avgPrice": "20.00"},
                        {"commodity": "CABBAGE", "avgPrice": "24.00"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = USDAWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("cabbage") == 22.0


@respx.mock
def test_get_wholesale_price_error_returns_none(tmp_path):
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(503))
    src = USDAWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("cabbage") is None
