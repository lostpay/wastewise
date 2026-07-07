import httpx
from wastewise.adapters.base import FileCache

REPORT_URL = "https://marsapi.ams.usda.gov/services/v1.2/reports/2315"


class USDAWholesale:
    def __init__(self, api_key: str, cache: FileCache,
                 client: httpx.Client | None = None):
        self.api_key = api_key
        self.cache = cache
        self.client = client or httpx.Client(timeout=10)

    def get_wholesale_price(self, item: str) -> float | None:
        key = f"usda/{item.lower()}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached.get("price")
        try:
            resp = self.client.get(REPORT_URL, auth=(self.api_key, ""),
                                   params={"q": f"commodity={item}"})
            resp.raise_for_status()
            price = self._avg_price(resp.json(), item)
        except httpx.HTTPError:
            return None
        if price is not None:
            self.cache.set(key, {"price": price})
        return price

    @staticmethod
    def _avg_price(payload: dict, item: str) -> float | None:
        rows = payload.get("results", [])
        prices = []
        for r in rows:
            if item.lower() in str(r.get("commodity", "")).lower():
                try:
                    prices.append(float(r["avgPrice"]))
                except (KeyError, ValueError, TypeError):
                    continue
        return round(sum(prices) / len(prices), 2) if prices else None
