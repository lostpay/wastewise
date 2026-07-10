import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_fred import FredWholesale

BASE = "https://api.stlouisfed.org/fred/series/observations"


@respx.mock
def test_get_wholesale_price_returns_latest_observation(tmp_path):
    body = {"observations": [{"date": "2026-05-01", "value": "2.19"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("eggs") == 2.19


@respx.mock
def test_get_wholesale_price_skips_missing_values(tmp_path):
    body = {"observations": [{"date": "2026-05-01", "value": "."},
                             {"date": "2026-04-01", "value": "3.29"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("chicken") == 3.29


def test_get_wholesale_price_unknown_item_returns_none(tmp_path):
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("paneer") is None


@respx.mock
def test_get_wholesale_price_error_returns_none(tmp_path):
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(503))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("eggs") is None


@respx.mock
def test_get_wholesale_price_requests_enough_history_to_skip_missing(tmp_path):
    route = respx.get(url__startswith=BASE).mock(
        return_value=httpx.Response(200, json={"observations": [{"date": "2026-05-01", "value": "2.19"}]}))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    src.get_wholesale_price("eggs")
    sent_limit = int(route.calls.last.request.url.params["limit"])
    assert sent_limit >= 6
