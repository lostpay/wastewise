# tests/test_api.py
import io
from fastapi.testclient import TestClient
from wastewise.models import WeatherInfo, SupplierPrice
import wastewise.api as api


class _Weather:
    def get_weather(self, date, location):
        return WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)


class _Holidays:
    def get_holidays(self, start, end): return []


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.0)]


class _LLM:
    def complete(self, system, user): return "note"


def _client(tmp_path):
    from wastewise.storage import DatasetStore
    deps = {"store": DatasetStore(str(tmp_path / "db.sqlite3")),
            "weather": _Weather(), "holidays": _Holidays(),
            "wholesale": _Wholesale(), "retail": _Retail(), "llm": _LLM()}
    api.app.dependency_overrides[api.get_deps] = lambda: deps
    return TestClient(api.app)


def test_health():
    assert TestClient(api.app).get("/health").json() == {"status": "ok"}


def test_upload_then_forecast_then_sourcing(tmp_path):
    client = _client(tmp_path)
    csv = "date,item,quantity\n" + "".join(
        f"2026-04-{d:02d},cabbage,{20 + d % 3}\n" for d in range(1, 29))
    r = client.post("/upload", files={"file": ("s.csv", io.BytesIO(csv.encode()),
                    "text/csv")})
    ds_id = r.json()["dataset_id"]
    assert r.json()["summary"]["n_rows"] == 28

    f = client.post("/forecast", json={"dataset_id": ds_id, "horizon": "week",
                    "location": "40.7,-74.0"})
    assert f.status_code == 200
    items = f.json()["items"]
    assert items[0]["item"] == "cabbage"

    s = client.post("/sourcing", json={"items": [{"item": "cabbage", "qty": 10}],
                    "location": "40.7,-74.0"})
    assert s.json()["lines"][0]["supplier"] == "Kroger"
    api.app.dependency_overrides.clear()
