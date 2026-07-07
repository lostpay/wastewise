# tests/test_integration.py
from fastapi.testclient import TestClient
from wastewise.models import WeatherInfo, SupplierPrice
import wastewise.api as api


class _Weather:
    def get_weather(self, date, location):
        return WeatherInfo(condition="Rain likely", temp_c=16, precipitation_mm=7)


class _Holidays:
    def get_holidays(self, start, end): return []


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.4)]


class _LLM:
    def complete(self, system, user):
        # valid adjustment JSON for the adjustment step; plain note otherwise
        if "JSON array" in system:
            return ('[{"item":"cabbage","adjusted_qty":30,"reason":"Rain lowers demand"},'
                    '{"item":"pork","adjusted_qty":20,"reason":"Rain lowers demand"},'
                    '{"item":"chicken","adjusted_qty":28,"reason":"Rain lowers demand"}]')
        return "Kroger is 30% below market."


def test_end_to_end_demo(tmp_path):
    from wastewise.storage import DatasetStore
    deps = {"store": DatasetStore(str(tmp_path / "db.sqlite3")),
            "weather": _Weather(), "holidays": _Holidays(),
            "wholesale": _Wholesale(), "retail": _Retail(), "llm": _LLM()}
    api.app.dependency_overrides[api.get_deps] = lambda: deps
    client = TestClient(api.app)

    with open("wastewise/data/demo_sales.csv", "rb") as fh:
        r = client.post("/upload", files={"file": ("demo.csv", fh, "text/csv")})
    ds_id = r.json()["dataset_id"]

    f = client.post("/forecast", json={"dataset_id": ds_id, "horizon": "week"})
    assert f.status_code == 200
    items = f.json()["items"]
    assert len(items) == 3
    assert all("reason" in it for it in items)

    qty_items = [{"item": it["item"], "qty": it["adjusted_qty"]} for it in items]
    s = client.post("/sourcing", json={"items": qty_items})
    body = s.json()
    assert len(body["lines"]) == 3
    assert body["total"] > 0
    api.app.dependency_overrides.clear()
