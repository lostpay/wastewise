import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_kroger import KrogerRetail, DEFAULT_LOCATION_ID

TOKEN = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCTS = "https://api.kroger.com/v1/products"
LOCATIONS = "https://api.kroger.com/v1/locations"

_PRODUCTS_BODY = {"data": [{"items": [{"price": {"regular": 1.50, "promo": 0}}]}]}


def _mock_token():
    respx.post(TOKEN).mock(
        return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 1800}))


def _mock_locations(location_id="09800111"):
    return respx.get(url__startswith=LOCATIONS).mock(
        return_value=httpx.Response(200, json={"data": [{"locationId": location_id}]}))


@respx.mock
def test_get_retail_prices_returns_supplier_price(tmp_path):
    _mock_token()
    _mock_locations()
    respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    prices = src.get_retail_prices("cabbage", "40.7,-74.0")
    assert prices[0].supplier == "Kroger"
    assert prices[0].unit_price == 1.50


@respx.mock
def test_products_query_includes_resolved_location_id(tmp_path):
    _mock_token()
    _mock_locations(location_id="09800111")
    products = respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    src.get_retail_prices("cabbage", "39.1,-84.5")
    sent = products.calls.last.request.url
    assert sent.params["filter.locationId"] == "09800111"


@respx.mock
def test_no_nearby_store_falls_back_to_default_location(tmp_path):
    _mock_token()
    respx.get(url__startswith=LOCATIONS).mock(
        return_value=httpx.Response(200, json={"data": []}))  # e.g. NYC: no Kroger
    products = respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    prices = src.get_retail_prices("cabbage", "40.7,-74.0")
    assert prices[0].unit_price == 1.50
    assert products.calls.last.request.url.params["filter.locationId"] == DEFAULT_LOCATION_ID


@respx.mock
def test_location_lookup_error_falls_back_to_default(tmp_path):
    _mock_token()
    respx.get(url__startswith=LOCATIONS).mock(return_value=httpx.Response(500))
    products = respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    prices = src.get_retail_prices("cabbage", "40.7,-74.0")
    assert prices[0].unit_price == 1.50
    assert products.calls.last.request.url.params["filter.locationId"] == DEFAULT_LOCATION_ID


@respx.mock
def test_get_retail_prices_error_returns_empty(tmp_path):
    respx.post(TOKEN).mock(return_value=httpx.Response(401))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    assert src.get_retail_prices("cabbage", "40.7,-74.0") == []


@respx.mock
def test_token_is_reused_across_items(tmp_path):
    token_route = respx.post(TOKEN).mock(
        return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 1800}))
    _mock_locations()
    respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    # Two distinct items (distinct cache keys) both hit the network, but the
    # client-credentials token must be fetched only once, and the shared
    # location resolves once (cached per location).
    src.get_retail_prices("cabbage", "40.7,-74.0")
    src.get_retail_prices("pork", "40.7,-74.0")
    assert token_route.call_count == 1
