import httpx
from wastewise.adapters.base import FileCache
from wastewise.models import SupplierPrice

TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCTS_URL = "https://api.kroger.com/v1/products"


class KrogerRetail:
    def __init__(self, client_id: str, client_secret: str, cache: FileCache,
                 client: httpx.Client | None = None):
        self.client_id = client_id
        self.client_secret = client_secret
        self.cache = cache
        self.client = client or httpx.Client(timeout=10)

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        key = f"kroger/{item.lower()}/{location}"
        cached = self.cache.get(key)
        if cached is not None:
            return [SupplierPrice(**p) for p in cached["prices"]]
        try:
            token = self._token()
            resp = self.client.get(
                PRODUCTS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={"filter.term": item, "filter.limit": 1})
            resp.raise_for_status()
            price = self._first_price(resp.json())
        except httpx.HTTPError:
            return []
        if price is None:
            return []
        out = [SupplierPrice(supplier="Kroger", unit_price=price)]
        self.cache.set(key, {"prices": [p.model_dump() for p in out]})
        return out

    def _token(self) -> str:
        resp = self.client.post(
            TOKEN_URL,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials", "scope": "product.compact"})
        resp.raise_for_status()
        return resp.json()["access_token"]

    @staticmethod
    def _first_price(payload: dict) -> float | None:
        data = payload.get("data", [])
        if not data or not data[0].get("items"):
            return None
        p = data[0]["items"][0].get("price", {})
        val = p.get("promo") or p.get("regular")
        return float(val) if val else None
