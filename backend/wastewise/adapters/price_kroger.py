import time
import httpx
from wastewise.adapters.base import FileCache
from wastewise.models import SupplierPrice

TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token"
PRODUCTS_URL = "https://api.kroger.com/v1/products"
LOCATIONS_URL = "https://api.kroger.com/v1/locations"

# Kroger only returns prices for a specific store, so a request with no
# nearby store (e.g. the NYC default, where Kroger has no presence) still
# needs a real locationId. This Cincinnati store is used as the fallback.
DEFAULT_LOCATION_ID = "01400441"


class KrogerRetail:
    def __init__(self, client_id: str, client_secret: str, cache: FileCache,
                 client: httpx.Client | None = None,
                 default_location_id: str = DEFAULT_LOCATION_ID):
        self.client_id = client_id
        self.client_secret = client_secret
        self.cache = cache
        self.client = client or httpx.Client(timeout=10)
        self.default_location_id = default_location_id
        self._token_value: str | None = None
        self._token_expiry: float = 0.0

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        key = f"kroger/{item.lower()}/{location}"
        cached = self.cache.get(key)
        if cached is not None:
            return [SupplierPrice(**p) for p in cached["prices"]]
        try:
            location_id = self._location_id(location)
            token = self._token()
            resp = self.client.get(
                PRODUCTS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={"filter.term": item, "filter.limit": 1,
                        "filter.locationId": location_id})
            resp.raise_for_status()
            price = self._first_price(resp.json())
        except httpx.HTTPError:
            return []
        if price is None:
            return []
        out = [SupplierPrice(supplier="Kroger", unit_price=price)]
        self.cache.set(key, {"prices": [p.model_dump() for p in out]})
        return out

    def _location_id(self, location: str) -> str:
        # Kroger prices are per-store, so resolve the request's "lat,lon" to the
        # nearest store's id. Fall back to a default store when none is nearby or
        # the lookup fails, so pricing degrades to a real store instead of $0.00.
        key = f"kroger-loc/{location}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached["location_id"]
        try:
            token = self._token()
            resp = self.client.get(
                LOCATIONS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={"filter.latLong.near": location, "filter.limit": 1})
            resp.raise_for_status()
            data = resp.json().get("data", [])
        except httpx.HTTPError:
            return self.default_location_id  # transient: retry next call
        loc_id = data[0].get("locationId") if data else None
        loc_id = loc_id or self.default_location_id
        self.cache.set(key, {"location_id": loc_id})
        return loc_id

    def _token(self) -> str:
        # Reuse the client-credentials token until it nears expiry so a
        # multi-item sourcing request doesn't re-authenticate per line item.
        now = time.time()
        if self._token_value is not None and now < self._token_expiry:
            return self._token_value
        resp = self.client.post(
            TOKEN_URL,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials", "scope": "product.compact"})
        resp.raise_for_status()
        body = resp.json()
        self._token_value = body["access_token"]
        # Kroger tokens last ~30 min; refresh 60s early. Default if omitted.
        self._token_expiry = now + float(body.get("expires_in", 1800)) - 60
        return self._token_value

    @staticmethod
    def _first_price(payload: dict) -> float | None:
        data = payload.get("data", [])
        if not data or not data[0].get("items"):
            return None
        p = data[0]["items"][0].get("price", {})
        val = p.get("promo") or p.get("regular")
        return float(val) if val else None
