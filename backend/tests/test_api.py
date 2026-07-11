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

    f = client.post("/forecast", json={"dataset_id": ds_id, "horizon_days": 7,
                    "location": "40.7,-74.0"})
    assert f.status_code == 200
    items = f.json()["items"]
    assert items[0]["item"] == "cabbage"

    s = client.post("/sourcing", json={"items": [{"item": "cabbage", "qty": 10}],
                    "location": "40.7,-74.0"})
    assert s.json()["lines"][0]["supplier"] == "Kroger"
    api.app.dependency_overrides.clear()


def test_forecast_rejects_malformed_location(tmp_path):
    client = _client(tmp_path)
    r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": 7,
                    "location": "not-a-latlon"})
    assert r.status_code == 422
    api.app.dependency_overrides.clear()


def test_upload_rejects_non_utf8(tmp_path):
    client = _client(tmp_path)
    r = client.post("/upload", files={"file": ("s.csv",
                    io.BytesIO(b"\xff\xfe\x00bad"), "text/csv")})
    assert r.status_code == 400
    api.app.dependency_overrides.clear()


def test_sourcing_falls_back_to_historical_price_for_unmatched_item(tmp_path):
    from wastewise.storage import DatasetStore

    class _NoMatchWholesale:
        def get_wholesale_price(self, item): return None

    class _NoMatchRetail:
        def get_retail_prices(self, item, location): return []

    deps = {"store": DatasetStore(str(tmp_path / "db.sqlite3")),
            "weather": _Weather(), "holidays": _Holidays(),
            "wholesale": _NoMatchWholesale(), "retail": _NoMatchRetail(), "llm": _LLM()}
    api.app.dependency_overrides[api.get_deps] = lambda: deps
    client = TestClient(api.app)

    csv = ("date,item,quantity,price\n"
           "2026-04-01,mutton,2,600\n"
           "2026-04-02,mutton,1.8,620\n")
    r = client.post("/upload", files={"file": ("s.csv", io.BytesIO(csv.encode()), "text/csv")})
    ds_id = r.json()["dataset_id"]

    s = client.post("/sourcing", json={"items": [{"item": "mutton", "qty": 5}],
                    "location": "40.7,-74.0", "dataset_id": ds_id})
    assert s.status_code == 200
    line = s.json()["lines"][0]
    assert line["supplier"] == "Historical average"
    assert line["unit_price"] == 610.0
    api.app.dependency_overrides.clear()


def test_sourcing_keeps_fred_covered_item_in_savings_but_excludes_historical_only(tmp_path):
    # The core honesty fix: an item FRED covers must stay in the savings total
    # even when the uploaded CSV also happens to price it, while an item only
    # the CSV prices (no FRED benchmark) is shown but excluded from savings.
    from wastewise.storage import DatasetStore

    class _PartialWholesale:
        # FRED covers cabbage but not mutton.
        def get_wholesale_price(self, item):
            return 2.0 if item.lower() == "cabbage" else None

    class _CabbageRetail:
        # Kroger stocks cabbage cheaply; nothing for mutton.
        def get_retail_prices(self, item, location):
            if item.lower() == "cabbage":
                return [SupplierPrice(supplier="Kroger", unit_price=1.5)]
            return []

    deps = {"store": DatasetStore(str(tmp_path / "db.sqlite3")),
            "weather": _Weather(), "holidays": _Holidays(),
            "wholesale": _PartialWholesale(), "retail": _CabbageRetail(), "llm": _LLM()}
    api.app.dependency_overrides[api.get_deps] = lambda: deps
    client = TestClient(api.app)

    # CSV prices BOTH items -- cabbage (FRED-covered) and mutton (not).
    csv = ("date,item,quantity,price\n"
           "2026-04-01,cabbage,2,3\n"
           "2026-04-01,mutton,2,600\n"
           "2026-04-02,mutton,1.8,620\n")
    r = client.post("/upload", files={"file": ("s.csv", io.BytesIO(csv.encode()), "text/csv")})
    ds_id = r.json()["dataset_id"]

    s = client.post("/sourcing", json={
        "items": [{"item": "cabbage", "qty": 10}, {"item": "mutton", "qty": 5}],
        "location": "40.7,-74.0", "dataset_id": ds_id})
    assert s.status_code == 200
    lines = {ln["item"]: ln for ln in s.json()["lines"]}

    # cabbage: real FRED benchmark (2.0) survives even though the CSV priced it
    # too; Kroger (1.5) beats it, so it counts toward savings.
    assert lines["cabbage"]["benchmark"] == 2.0
    assert lines["cabbage"]["unit_price"] == 1.5
    # mutton: FRED has nothing -> historical-only benchmark, no US comparison.
    assert lines["mutton"]["benchmark"] is None

    # Savings come only from cabbage: (2.0 - 1.5) * 10 = 5.0
    assert s.json()["savings"] == 5.0
    api.app.dependency_overrides.clear()


def test_sourcing_dataset_id_404_when_unknown(tmp_path):
    client = _client(tmp_path)
    r = client.post("/sourcing", json={"items": [{"item": "mutton", "qty": 5}],
                    "location": "40.7,-74.0", "dataset_id": "does-not-exist"})
    assert r.status_code == 404
    api.app.dependency_overrides.clear()


def test_rationale_endpoint_returns_paragraph_and_live_flag(tmp_path):
    client = _client(tmp_path)
    body = {
        "items": [{"item": "cabbage", "forecast": 168, "adjusted_qty": 150,
                   "reason": "Rain lowers dine-in demand.", "live": True}],
        "lines": [{"item": "cabbage", "qty": 150, "supplier": "Kroger",
                   "unit_price": 1.4, "line_total": 210.0,
                   "note": "30% under the US retail average.", "live": True}],
        "savings": 30.0,
        "total": 210.0,
    }
    r = client.post("/rationale", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["paragraph"] == "note"  # _LLM.complete always returns "note"
    assert data["live"] is True
    api.app.dependency_overrides.clear()


def test_forecast_rejects_out_of_range_horizon(tmp_path):
    client = _client(tmp_path)
    for bad in (0, 15):
        r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": bad,
                        "location": "40.7,-74.0"})
        assert r.status_code == 422
    api.app.dependency_overrides.clear()
