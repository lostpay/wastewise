import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_kroger import KrogerRetail

TOKEN = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCTS = "https://api.kroger.com/v1/products"


@respx.mock
def test_get_retail_prices_returns_supplier_price(tmp_path):
    respx.post(TOKEN).mock(return_value=httpx.Response(200, json={"access_token": "t"}))
    products = {"data": [{"items": [{"price": {"regular": 1.50, "promo": 0}}]}]}
    respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=products))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    prices = src.get_retail_prices("cabbage", "40.7,-74.0")
    assert prices[0].supplier == "Kroger"
    assert prices[0].unit_price == 1.50


@respx.mock
def test_get_retail_prices_error_returns_empty(tmp_path):
    respx.post(TOKEN).mock(return_value=httpx.Response(401))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    assert src.get_retail_prices("cabbage", "40.7,-74.0") == []


@respx.mock
def test_token_is_reused_across_items(tmp_path):
    token_route = respx.post(TOKEN).mock(
        return_value=httpx.Response(200, json={"access_token": "t", "expires_in": 1800}))
    products = {"data": [{"items": [{"price": {"regular": 1.50, "promo": 0}}]}]}
    respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=products))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    # Two distinct items (distinct cache keys) both hit the network, but the
    # client-credentials token must be fetched only once.
    src.get_retail_prices("cabbage", "40.7,-74.0")
    src.get_retail_prices("pork", "40.7,-74.0")
    assert token_route.call_count == 1
