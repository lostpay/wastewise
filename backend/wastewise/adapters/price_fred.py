import httpx
from wastewise.adapters.base import FileCache

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"

# BLS average US retail price series, exposed via FRED. Covers the subset of
# the demo CSV that BLS tracks — items outside this map return None and the
# sourcing layer falls back to its "no benchmark" branch.
SERIES: dict[str, str] = {
    "chicken": "APU0000706111",
    "eggs": "APU0000708111",
    "milk": "APU0000709112",
    "tomato": "APU0000712311",
    "tomatoes": "APU0000712311",
    "rice": "APU0000701312",
    "sugar": "APU0000715211",
}


class FredWholesale:
    def __init__(self, api_key: str, cache: FileCache,
                 client: httpx.Client | None = None):
        self.api_key = api_key
        self.cache = cache
        self.client = client or httpx.Client(timeout=10)

    def get_wholesale_price(self, item: str) -> float | None:
        series_id = SERIES.get(item.lower().strip())
        if series_id is None:
            return None
        key = f"fred/{series_id}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached.get("price")
        try:
            resp = self.client.get(FRED_URL, params={
                "series_id": series_id,
                "api_key": self.api_key,
                "sort_order": "desc",
                "limit": 6,  # enough months that a "." (unfinalized) latest value can fall through to an earlier one
                "file_type": "json",
            })
            resp.raise_for_status()
            price = self._latest_price(resp.json())
        except httpx.HTTPError:
            return None
        if price is not None:
            self.cache.set(key, {"price": price})
        return price

    @staticmethod
    def _latest_price(payload: dict) -> float | None:
        obs = payload.get("observations", [])
        for row in obs:
            val = row.get("value")
            if val in (None, "", "."):
                continue
            try:
                return round(float(val), 2)
            except (TypeError, ValueError):
                continue
        return None
