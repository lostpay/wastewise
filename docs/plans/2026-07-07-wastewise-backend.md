# WasteWise Backend Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WasteWise backend — a FastAPI service that turns a restaurant's sales history into an adjusted purchase plan and a sourced, drafted purchase order, with the two judgment steps run by an LLM on an OpenAI-compatible endpoint (vLLM/MI300X in prod, Fireworks in dev).

**Architecture:** A linear pipeline — `sales CSV → forecast (XGBoost + baseline) → adjustment agent (weather/holiday) → sourcing agent (USDA + Kroger prices) → drafted PO`. Deterministic data tools feed two schema-validated LLM steps; every LLM step has a non-LLM fallback so the API never hard-fails. Data sources sit behind swappable adapter interfaces with a local cache.

**Tech Stack:** Python 3.11, FastAPI, uvicorn, Pydantic v2, pydantic-settings, pandas, xgboost, httpx, openai (client), pytest, respx (httpx mocking), python-multipart. Storage: stdlib `sqlite3`.

## Global Constraints

- **Language of all agent-generated output: English.** (Hackathon all-tracks rule.)
- **Per-request latency budget: < 30 seconds.** Keep the pipeline to a small number of LLM calls.
- **LLM access is via an OpenAI-compatible client only.** Read `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` from the environment. Production path is AMD compute (vLLM/MI300X); Fireworks is a dev-only convenience and is optional.
- **Never hardcode or fake agent answers.** Caching *external API responses* (weather/prices) for reliability is allowed; scripting the agent's reasoning to specific inputs is not.
- **Secrets come from the environment / `.env`. Never commit `.env`.**
- **Forecasting is item-level only** (no recipe/BOM mapping in this plan).
- **Data adapters implement a common interface** and are swappable per market.
- **License: MIT.** A `LICENSE` file must exist in the repo.
- **Commit messages: plain Conventional Commits, no AI-attribution trailer.**
- All commands run from the `backend/` directory unless stated otherwise. Git resolves the repo root automatically.

---

## File Structure

```
backend/
  pyproject.toml                 # deps + pytest config (pythonpath=".")
  .env.example                   # documents required env vars (committed)
  README.md                      # backend usage + AMD/MI300X usage note
  wastewise/
    __init__.py
    config.py                    # Settings (env), pydantic-settings
    models.py                    # Pydantic domain models
    storage.py                   # SQLite dataset store
    ingest.py                    # CSV parse + validation
    data/demo_sales.csv          # bundled demo dataset (generated)
    forecasting/
      __init__.py
      baseline.py                # seasonal-naive baseline
      features.py                # feature engineering
      forecaster.py             # XGBoost + baseline + backtest delta
    adapters/
      __init__.py
      base.py                    # interfaces + file cache
      weather_noaa.py            # WeatherSource impl (NOAA)
      holidays.py                # HolidaySource impl
      price_usda.py              # wholesale benchmark
      price_kroger.py            # retail prices
    agents/
      __init__.py
      llm.py                     # OpenAI-compatible client wrapper
      adjustment.py              # adjustment agent (+ fallback)
      sourcing.py                # sourcing agent (+ fallback)
    pipeline.py                  # orchestration functions
    api.py                       # FastAPI app + endpoints + CORS
  tests/
    conftest.py                  # shared fixtures (sample sales, fake llm)
    test_models.py
    test_storage.py
    test_ingest.py
    test_baseline.py
    test_forecaster.py
    test_adapters_cache.py
    test_weather_noaa.py
    test_holidays.py
    test_price_usda.py
    test_price_kroger.py
    test_llm.py
    test_adjustment.py
    test_sourcing.py
    test_pipeline.py
    test_api.py
    test_integration.py
```

---

## API contract (produced by this plan)

```
GET  /health   -> {"status": "ok"}
POST /upload   (multipart form field `file`: CSV) -> {"dataset_id": str, "summary": {...}}
POST /forecast {"dataset_id": str, "horizon": "day"|"week", "location": str}
               -> {"items": [{item, forecast, adjusted_qty, reason}], "baseline_delta": float}
POST /sourcing {"items": [{"item": str, "qty": float}], "location": str}
               -> {"lines": [{item, qty, supplier, unit_price, line_total, note}],
                   "total": float, "savings": float}
```

---

### Task 0: Project scaffold

**Files:**
- Create: `backend/pyproject.toml`, `backend/.env.example`, `backend/README.md`, `backend/wastewise/__init__.py`, `backend/wastewise/config.py`, `backend/tests/__init__.py`
- Create: `LICENSE` (repo root), `.gitignore` (repo root)

**Interfaces:**
- Produces: `wastewise.config.Settings` with attributes `llm_base_url: str`, `llm_api_key: str`, `llm_model: str`, `db_path: str`, `cache_dir: str`, `usda_api_key: str`, `kroger_client_id: str`, `kroger_client_secret: str`; and `get_settings() -> Settings`.

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "wastewise"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.111",
  "uvicorn>=0.30",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "pandas>=2.2",
  "xgboost>=2.0",
  "httpx>=0.27",
  "openai>=1.30",
  "python-multipart>=0.0.9",
]

[project.optional-dependencies]
dev = ["pytest>=8.2", "respx>=0.21"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

- [ ] **Step 2: Create `LICENSE` (repo root) — MIT**

Write the standard MIT License text with copyright line: `Copyright (c) 2026 <your name>`.

- [ ] **Step 3: Create `.gitignore` (repo root)**

```
__pycache__/
*.pyc
.venv/
.env
backend/wastewise/data/cache/
*.sqlite3
.pytest_cache/
node_modules/
.next/
```

- [ ] **Step 4: Create `backend/.env.example`**

```
LLM_BASE_URL=https://api.fireworks.ai/inference/v1
LLM_API_KEY=changeme
LLM_MODEL=accounts/fireworks/models/llama-v3p1-8b-instruct
USDA_API_KEY=changeme
KROGER_CLIENT_ID=changeme
KROGER_CLIENT_SECRET=changeme
DB_PATH=wastewise.sqlite3
CACHE_DIR=wastewise/data/cache
```

- [ ] **Step 5: Create `backend/wastewise/config.py`**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    llm_base_url: str = "https://api.fireworks.ai/inference/v1"
    llm_api_key: str = "changeme"
    llm_model: str = "accounts/fireworks/models/llama-v3p1-8b-instruct"
    usda_api_key: str = "changeme"
    kroger_client_id: str = "changeme"
    kroger_client_secret: str = "changeme"
    db_path: str = "wastewise.sqlite3"
    cache_dir: str = "wastewise/data/cache"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Create empty `backend/wastewise/__init__.py` and `backend/tests/__init__.py`**

- [ ] **Step 7: Create `backend/README.md`** with a stub including this section (required for hackathon pre-screening):

```markdown
# WasteWise Backend

## AMD compute usage
LLM inference for both agent steps runs on AMD Instinct MI300X via vLLM (ROCm),
served with an OpenAI-compatible endpoint. Set `LLM_BASE_URL` to the vLLM endpoint
for submission. See `docs/` for the `rocm-smi` / vLLM endpoint screenshot.
```

- [ ] **Step 8: Install and verify**

Run: `python -m venv .venv && . .venv/Scripts/activate` (Windows PowerShell: `.venv\Scripts\Activate.ps1`) then `pip install -e ".[dev]"`
Expected: installs without error.

Run: `python -c "from wastewise.config import get_settings; print(get_settings().llm_model)"`
Expected: prints the model id.

- [ ] **Step 9: Commit**

```bash
git add backend/pyproject.toml backend/.env.example backend/README.md backend/wastewise backend/tests LICENSE .gitignore
git commit -m "chore: scaffold backend package, config, and license"
```

---

### Task 1: Domain models

**Files:**
- Create: `backend/wastewise/models.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Produces:
  - `SalesRecord(date: datetime.date, item: str, quantity: float, price: float | None)`
  - `DatasetSummary(dataset_id: str, n_rows: int, items: list[str], start_date: date, end_date: date)`
  - `ForecastItem(item: str, forecast: float, baseline: float, safety_buffer: float, recommended_purchase_qty: float)`
  - `AdjustedItem(item: str, forecast: float, adjusted_qty: float, reason: str)`
  - `ForecastResponse(items: list[AdjustedItem], baseline_delta: float)`
  - `POLine(item: str, qty: float, supplier: str, unit_price: float, line_total: float, note: str)`
  - `SourcingResponse(lines: list[POLine], total: float, savings: float)`
  - `WeatherInfo(condition: str, temp_c: float, precipitation_mm: float)`
  - `Holiday(date: date, name: str)`
  - `SupplierPrice(supplier: str, unit_price: float)`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models.py
import datetime
from wastewise.models import ForecastItem, AdjustedItem, POLine, SourcingResponse


def test_forecast_item_defaults_and_types():
    fi = ForecastItem(item="cabbage", forecast=10.0, baseline=9.0,
                      safety_buffer=2.0, recommended_purchase_qty=12.0)
    assert fi.item == "cabbage"
    assert fi.recommended_purchase_qty == 12.0


def test_sourcing_response_roundtrips():
    line = POLine(item="cabbage", qty=12, supplier="Kroger",
                  unit_price=1.5, line_total=18.0, note="8% under market")
    resp = SourcingResponse(lines=[line], total=18.0, savings=1.6)
    assert resp.model_dump()["lines"][0]["supplier"] == "Kroger"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py -v`
Expected: FAIL with `ModuleNotFoundError: wastewise.models`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/models.py
import datetime
from pydantic import BaseModel


class SalesRecord(BaseModel):
    date: datetime.date
    item: str
    quantity: float
    price: float | None = None


class DatasetSummary(BaseModel):
    dataset_id: str
    n_rows: int
    items: list[str]
    start_date: datetime.date
    end_date: datetime.date


class ForecastItem(BaseModel):
    item: str
    forecast: float
    baseline: float
    safety_buffer: float
    recommended_purchase_qty: float


class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str


class ForecastResponse(BaseModel):
    items: list[AdjustedItem]
    baseline_delta: float


class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str


class SourcingResponse(BaseModel):
    lines: list[POLine]
    total: float
    savings: float


class WeatherInfo(BaseModel):
    condition: str
    temp_c: float
    precipitation_mm: float


class Holiday(BaseModel):
    date: datetime.date
    name: str


class SupplierPrice(BaseModel):
    supplier: str
    unit_price: float
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/tests/test_models.py
git commit -m "feat: add domain models"
```

---

### Task 2: SQLite dataset store

**Files:**
- Create: `backend/wastewise/storage.py`
- Test: `backend/tests/test_storage.py`

**Interfaces:**
- Consumes: `SalesRecord` from Task 1.
- Produces:
  - `DatasetStore(db_path: str)`
  - `.save(records: list[SalesRecord]) -> str` (returns generated `dataset_id`)
  - `.load(dataset_id: str) -> list[SalesRecord]` (raises `KeyError` if missing)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_storage.py
import datetime
import pytest
from wastewise.models import SalesRecord
from wastewise.storage import DatasetStore


def _records():
    return [
        SalesRecord(date=datetime.date(2026, 1, 1), item="cabbage", quantity=5),
        SalesRecord(date=datetime.date(2026, 1, 2), item="cabbage", quantity=7),
    ]


def test_save_then_load_roundtrip(tmp_path):
    store = DatasetStore(str(tmp_path / "t.sqlite3"))
    ds_id = store.save(_records())
    assert isinstance(ds_id, str) and len(ds_id) > 0
    loaded = store.load(ds_id)
    assert len(loaded) == 2
    assert loaded[0].item == "cabbage"


def test_load_missing_raises(tmp_path):
    store = DatasetStore(str(tmp_path / "t.sqlite3"))
    with pytest.raises(KeyError):
        store.load("nope")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage.py -v`
Expected: FAIL with `ModuleNotFoundError: wastewise.storage`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/storage.py
import json
import sqlite3
import uuid
from wastewise.models import SalesRecord


class DatasetStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS datasets "
                "(id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )

    def save(self, records: list[SalesRecord]) -> str:
        ds_id = uuid.uuid4().hex[:12]
        payload = json.dumps([r.model_dump(mode="json") for r in records])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO datasets (id, payload) VALUES (?, ?)",
                         (ds_id, payload))
        return ds_id

    def load(self, dataset_id: str) -> list[SalesRecord]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT payload FROM datasets WHERE id = ?",
                               (dataset_id,)).fetchone()
        if row is None:
            raise KeyError(dataset_id)
        return [SalesRecord(**r) for r in json.loads(row[0])]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/storage.py backend/tests/test_storage.py
git commit -m "feat: add sqlite dataset store"
```

---

### Task 3: Sales CSV ingestion + validation + demo dataset

**Files:**
- Create: `backend/wastewise/ingest.py`, `backend/wastewise/data/demo_sales.csv`
- Test: `backend/tests/test_ingest.py`, `backend/tests/conftest.py`

**Interfaces:**
- Consumes: `SalesRecord`, `DatasetSummary` from Task 1.
- Produces:
  - `parse_sales_csv(text: str) -> list[SalesRecord]` (raises `ValueError` on missing required columns)
  - `summarize(dataset_id: str, records: list[SalesRecord]) -> DatasetSummary`
  - `conftest.py` fixture `sample_sales` -> `list[SalesRecord]` (a weekly-seasonal series for 2 items over 10 weeks) reused by later tests.

- [ ] **Step 1: Write `conftest.py` with the shared fixture**

```python
# tests/conftest.py
import datetime
import pytest
from wastewise.models import SalesRecord


@pytest.fixture
def sample_sales():
    """Two items, 70 days, weekly seasonality (weekends higher)."""
    records = []
    start = datetime.date(2026, 4, 1)
    for d in range(70):
        day = start + datetime.timedelta(days=d)
        weekend = day.weekday() >= 5
        records.append(SalesRecord(date=day, item="cabbage",
                                   quantity=20 + (10 if weekend else 0)))
        records.append(SalesRecord(date=day, item="pork",
                                   quantity=15 + (5 if weekend else 0)))
    return records
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_ingest.py
import pytest
from wastewise.ingest import parse_sales_csv, summarize


def test_parse_valid_csv():
    text = "date,item,quantity\n2026-01-01,cabbage,5\n2026-01-02,pork,3\n"
    recs = parse_sales_csv(text)
    assert len(recs) == 2
    assert recs[0].item == "cabbage"
    assert recs[0].quantity == 5.0


def test_parse_missing_column_raises():
    with pytest.raises(ValueError):
        parse_sales_csv("day,thing\n2026-01-01,cabbage\n")


def test_summarize(sample_sales):
    summary = summarize("ds1", sample_sales)
    assert summary.dataset_id == "ds1"
    assert summary.n_rows == len(sample_sales)
    assert set(summary.items) == {"cabbage", "pork"}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pytest tests/test_ingest.py -v`
Expected: FAIL with `ModuleNotFoundError: wastewise.ingest`.

- [ ] **Step 4: Write minimal implementation**

```python
# wastewise/ingest.py
import csv
import datetime
import io
from wastewise.models import SalesRecord, DatasetSummary

REQUIRED = {"date", "item", "quantity"}


def parse_sales_csv(text: str) -> list[SalesRecord]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or not REQUIRED.issubset(set(reader.fieldnames)):
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    records = []
    for row in reader:
        records.append(SalesRecord(
            date=datetime.date.fromisoformat(row["date"].strip()),
            item=row["item"].strip(),
            quantity=float(row["quantity"]),
            price=float(row["price"]) if row.get("price") else None,
        ))
    return records


def summarize(dataset_id: str, records: list[SalesRecord]) -> DatasetSummary:
    dates = [r.date for r in records]
    return DatasetSummary(
        dataset_id=dataset_id,
        n_rows=len(records),
        items=sorted({r.item for r in records}),
        start_date=min(dates),
        end_date=max(dates),
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_ingest.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Generate the bundled demo dataset**

Run this one-off to write `wastewise/data/demo_sales.csv`:

```bash
python -c "
import datetime, csv, os
os.makedirs('wastewise/data', exist_ok=True)
start = datetime.date(2026, 4, 1)
with open('wastewise/data/demo_sales.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['date','item','quantity'])
    for d in range(90):
        day = start + datetime.timedelta(days=d)
        we = day.weekday() >= 5
        w.writerow([day.isoformat(),'cabbage',20+(10 if we else 0)])
        w.writerow([day.isoformat(),'pork',15+(5 if we else 0)])
        w.writerow([day.isoformat(),'chicken',25+(12 if we else 0)])
"
```
Expected: file `wastewise/data/demo_sales.csv` exists with a header + 270 rows.

- [ ] **Step 7: Commit**

```bash
git add backend/wastewise/ingest.py backend/wastewise/data/demo_sales.csv backend/tests/test_ingest.py backend/tests/conftest.py
git commit -m "feat: add sales csv ingestion, summary, and demo dataset"
```

---

### Task 4: Seasonal-naive baseline forecaster

**Files:**
- Create: `backend/wastewise/forecasting/__init__.py`, `backend/wastewise/forecasting/baseline.py`
- Test: `backend/tests/test_baseline.py`

**Interfaces:**
- Consumes: `SalesRecord` from Task 1.
- Produces: `baseline_forecast(records: list[SalesRecord], item: str, horizon_days: int) -> float` — sum over the next `horizon_days` of "same weekday last week" demand (mean per weekday over history).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_baseline.py
from wastewise.forecasting.baseline import baseline_forecast


def test_baseline_next_day_matches_weekday_mean(sample_sales):
    # cabbage weekday demand is 20 (weekday) / 30 (weekend); next-day should be ~one day
    val = baseline_forecast(sample_sales, "cabbage", horizon_days=1)
    assert 18 <= val <= 32


def test_baseline_week_sums_seven_days(sample_sales):
    day = baseline_forecast(sample_sales, "cabbage", horizon_days=1)
    week = baseline_forecast(sample_sales, "cabbage", horizon_days=7)
    assert week > day * 5  # roughly 7 days summed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_baseline.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/forecasting/baseline.py
import datetime
import statistics
from wastewise.models import SalesRecord


def baseline_forecast(records: list[SalesRecord], item: str, horizon_days: int) -> float:
    """Sum, over the next horizon_days, of the historical mean demand for that weekday."""
    hist = [r for r in records if r.item == item]
    if not hist:
        return 0.0
    by_weekday: dict[int, list[float]] = {}
    for r in hist:
        by_weekday.setdefault(r.date.weekday(), []).append(r.quantity)
    weekday_mean = {wd: statistics.fmean(v) for wd, v in by_weekday.items()}
    overall = statistics.fmean([r.quantity for r in hist])
    last_day = max(r.date for r in hist)
    total = 0.0
    for i in range(1, horizon_days + 1):
        future = last_day + datetime.timedelta(days=i)
        total += weekday_mean.get(future.weekday(), overall)
    return total
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_baseline.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/forecasting/__init__.py backend/wastewise/forecasting/baseline.py backend/tests/test_baseline.py
git commit -m "feat: add seasonal-naive baseline forecaster"
```

---

### Task 5: Feature engineering + XGBoost forecaster + backtest delta

**Files:**
- Create: `backend/wastewise/forecasting/features.py`, `backend/wastewise/forecasting/forecaster.py`
- Test: `backend/tests/test_forecaster.py`

**Interfaces:**
- Consumes: `SalesRecord`, `ForecastItem` (Task 1); `baseline_forecast` (Task 4).
- Produces:
  - `build_frame(records: list[SalesRecord]) -> pandas.DataFrame` with columns `[date, item, quantity, dow, weekofyear, month, lag7, roll7]`.
  - `forecast_items(records, horizon_days, safety_frac=0.15) -> tuple[list[ForecastItem], float]` — returns per-item forecasts and a `baseline_delta` (fractional MAE improvement of the model over baseline on a 7-day holdout; clamped to `[0.0, 1.0]`, `0.0` if not enough data).

`horizon_days` will be 1 (day) or 7 (week). `recommended_purchase_qty = forecast + safety_buffer`, `safety_buffer = safety_frac * forecast`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_forecaster.py
from wastewise.forecasting.forecaster import build_frame, forecast_items
from wastewise.models import ForecastItem


def test_build_frame_has_features(sample_sales):
    df = build_frame(sample_sales)
    for col in ["dow", "weekofyear", "month", "lag7", "roll7"]:
        assert col in df.columns


def test_forecast_items_returns_item_per_product(sample_sales):
    items, delta = forecast_items(sample_sales, horizon_days=7)
    names = {i.item for i in items}
    assert names == {"cabbage", "pork"}
    for it in items:
        assert isinstance(it, ForecastItem)
        assert it.forecast >= 0
        # recommended = forecast + 15% buffer
        assert abs(it.recommended_purchase_qty - it.forecast * 1.15) < 1e-6
    assert 0.0 <= delta <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_forecaster.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write `features.py`**

```python
# wastewise/forecasting/features.py
import pandas as pd
from wastewise.models import SalesRecord


def build_frame(records: list[SalesRecord]) -> pd.DataFrame:
    df = pd.DataFrame([{"date": r.date, "item": r.item, "quantity": r.quantity}
                       for r in records])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["item", "date"]).reset_index(drop=True)
    df["dow"] = df["date"].dt.dayofweek
    df["weekofyear"] = df["date"].dt.isocalendar().week.astype(int)
    df["month"] = df["date"].dt.month
    df["lag7"] = df.groupby("item")["quantity"].shift(7)
    df["roll7"] = (df.groupby("item")["quantity"]
                     .shift(1).rolling(7).mean().reset_index(level=0, drop=True))
    return df
```

- [ ] **Step 4: Write `forecaster.py`**

```python
# wastewise/forecasting/forecaster.py
import datetime
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from wastewise.models import SalesRecord, ForecastItem
from wastewise.forecasting.features import build_frame
from wastewise.forecasting.baseline import baseline_forecast

FEATURES = ["dow", "weekofyear", "month", "lag7", "roll7"]


def _train(df: pd.DataFrame) -> XGBRegressor:
    train = df.dropna(subset=FEATURES)
    model = XGBRegressor(n_estimators=120, max_depth=4, learning_rate=0.1,
                         random_state=0)
    model.fit(train[FEATURES], train["quantity"])
    return model


def _future_rows(df_item: pd.DataFrame, horizon_days: int) -> pd.DataFrame:
    """Build feature rows for the next horizon_days for a single item."""
    last_date = df_item["date"].max()
    recent_mean = df_item["quantity"].tail(7).mean()
    hist = {r["date"].date(): r["quantity"] for _, r in df_item.iterrows()}
    rows = []
    for i in range(1, horizon_days + 1):
        d = (last_date + pd.Timedelta(days=i))
        lag7_date = (d - pd.Timedelta(days=7)).date()
        rows.append({
            "dow": d.dayofweek,
            "weekofyear": int(d.isocalendar().week),
            "month": d.month,
            "lag7": hist.get(lag7_date, recent_mean),
            "roll7": recent_mean,
        })
    return pd.DataFrame(rows)


def forecast_items(records: list[SalesRecord], horizon_days: int,
                   safety_frac: float = 0.15) -> tuple[list[ForecastItem], float]:
    df = build_frame(records)
    model = _train(df)
    items: list[ForecastItem] = []
    for item, g in df.groupby("item"):
        future = _future_rows(g, horizon_days)
        pred = float(np.clip(model.predict(future[FEATURES]).sum(), 0, None))
        base = baseline_forecast(records, item, horizon_days)
        buffer = safety_frac * pred
        items.append(ForecastItem(item=item, forecast=round(pred, 2),
                                  baseline=round(base, 2),
                                  safety_buffer=round(buffer, 2),
                                  recommended_purchase_qty=round(pred + buffer, 2)))
    delta = _backtest_delta(records, df)
    return items, delta


def _backtest_delta(records: list[SalesRecord], df: pd.DataFrame) -> float:
    """Fractional MAE improvement of model vs baseline over a 7-day holdout."""
    cutoff = df["date"].max() - pd.Timedelta(days=7)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff].dropna(subset=FEATURES)
    if len(train_df.dropna(subset=FEATURES)) < 20 or test_df.empty:
        return 0.0
    model = _train(train_df)
    model_err, base_err = [], []
    for _, row in test_df.iterrows():
        yhat = float(model.predict(row[FEATURES].to_frame().T)[0])
        model_err.append(abs(yhat - row["quantity"]))
        base_err.append(abs(row["lag7"] - row["quantity"]))
    m, b = float(np.mean(model_err)), float(np.mean(base_err))
    if b == 0:
        return 0.0
    return float(np.clip((b - m) / b, 0.0, 1.0))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/test_forecaster.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/forecasting/features.py backend/wastewise/forecasting/forecaster.py backend/tests/test_forecaster.py
git commit -m "feat: add xgboost forecaster with backtest delta"
```

---

### Task 6: Adapter interfaces + file cache

**Files:**
- Create: `backend/wastewise/adapters/__init__.py`, `backend/wastewise/adapters/base.py`
- Test: `backend/tests/test_adapters_cache.py`

**Interfaces:**
- Produces:
  - `FileCache(cache_dir: str)` with `.get(key: str) -> dict | None` and `.set(key: str, value: dict) -> None` (persists one JSON file per key).
  - Protocol classes (documentation of the interface later adapters follow):
    - `WeatherSource.get_weather(date: datetime.date, location: str) -> WeatherInfo`
    - `HolidaySource.get_holidays(start: datetime.date, end: datetime.date) -> list[Holiday]`
    - `WholesaleSource.get_wholesale_price(item: str) -> float | None`
    - `RetailSource.get_retail_prices(item: str, location: str) -> list[SupplierPrice]`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_adapters_cache.py
from wastewise.adapters.base import FileCache


def test_cache_set_get_roundtrip(tmp_path):
    cache = FileCache(str(tmp_path))
    assert cache.get("k1") is None
    cache.set("k1", {"a": 1})
    assert cache.get("k1") == {"a": 1}


def test_cache_key_is_filesystem_safe(tmp_path):
    cache = FileCache(str(tmp_path))
    cache.set("weather/2026-01-01/New York", {"ok": True})
    assert cache.get("weather/2026-01-01/New York") == {"ok": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_adapters_cache.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/adapters/base.py
import datetime
import hashlib
import json
import os
from typing import Protocol
from wastewise.models import WeatherInfo, Holiday, SupplierPrice


class FileCache:
    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)

    def _path(self, key: str) -> str:
        h = hashlib.sha256(key.encode()).hexdigest()[:24]
        return os.path.join(self.cache_dir, f"{h}.json")

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def set(self, key: str, value: dict) -> None:
        with open(self._path(key), "w", encoding="utf-8") as f:
            json.dump(value, f)


class WeatherSource(Protocol):
    def get_weather(self, date: datetime.date, location: str) -> WeatherInfo: ...


class HolidaySource(Protocol):
    def get_holidays(self, start: datetime.date, end: datetime.date) -> list[Holiday]: ...


class WholesaleSource(Protocol):
    def get_wholesale_price(self, item: str) -> float | None: ...


class RetailSource(Protocol):
    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_adapters_cache.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/__init__.py backend/wastewise/adapters/base.py backend/tests/test_adapters_cache.py
git commit -m "feat: add adapter interfaces and file cache"
```

---

### Task 7: NOAA weather adapter

**Files:**
- Create: `backend/wastewise/adapters/weather_noaa.py`
- Test: `backend/tests/test_weather_noaa.py`

**Interfaces:**
- Consumes: `WeatherInfo` (Task 1), `FileCache` (Task 6).
- Produces: `NOAAWeather(cache: FileCache, client: httpx.Client | None = None)` implementing `.get_weather(date, location) -> WeatherInfo`. `location` is `"lat,lon"`. Uses `https://api.weather.gov/points/{lat},{lon}` then the returned forecast URL; parses the period matching `date`. On any HTTP error, returns a neutral `WeatherInfo(condition="unknown", temp_c=20.0, precipitation_mm=0.0)`.

> Note: `api.weather.gov` returns a `forecast` URL from the points endpoint; the plan mocks both calls. Verify field names against a live call on first integration run; the parse is isolated in `_parse_period` for easy adjustment.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_weather_noaa.py
import datetime
import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_noaa import NOAAWeather


@respx.mock
def test_get_weather_parses_forecast(tmp_path):
    points = {"properties": {"forecast": "https://api.weather.gov/gridpoints/X/1,2/forecast"}}
    forecast = {"properties": {"periods": [
        {"startTime": "2026-07-09T06:00:00-04:00", "temperature": 68,
         "temperatureUnit": "F", "shortForecast": "Rain likely",
         "probabilityOfPrecipitation": {"value": 80}},
    ]}}
    respx.get("https://api.weather.gov/points/40.7,-74.0").mock(
        return_value=httpx.Response(200, json=points))
    respx.get("https://api.weather.gov/gridpoints/X/1,2/forecast").mock(
        return_value=httpx.Response(200, json=forecast))

    w = NOAAWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 9), "40.7,-74.0")
    assert "rain" in info.condition.lower()
    assert info.precipitation_mm > 0


@respx.mock
def test_get_weather_http_error_returns_neutral(tmp_path):
    respx.get("https://api.weather.gov/points/40.7,-74.0").mock(
        return_value=httpx.Response(500))
    w = NOAAWeather(FileCache(str(tmp_path)))
    info = w.get_weather(datetime.date(2026, 7, 9), "40.7,-74.0")
    assert info.condition == "unknown"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_weather_noaa.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/adapters/weather_noaa.py
import datetime
import httpx
from wastewise.adapters.base import FileCache
from wastewise.models import WeatherInfo

NEUTRAL = WeatherInfo(condition="unknown", temp_c=20.0, precipitation_mm=0.0)


class NOAAWeather:
    def __init__(self, cache: FileCache, client: httpx.Client | None = None):
        self.cache = cache
        self.client = client or httpx.Client(
            timeout=10, headers={"User-Agent": "WasteWise/0.1"})

    def get_weather(self, date: datetime.date, location: str) -> WeatherInfo:
        key = f"weather/{location}/{date.isoformat()}"
        cached = self.cache.get(key)
        if cached is not None:
            return WeatherInfo(**cached)
        try:
            pts = self.client.get(f"https://api.weather.gov/points/{location}")
            pts.raise_for_status()
            url = pts.json()["properties"]["forecast"]
            fc = self.client.get(url)
            fc.raise_for_status()
            info = self._parse_period(fc.json()["properties"]["periods"], date)
        except (httpx.HTTPError, KeyError, IndexError):
            return NEUTRAL
        self.cache.set(key, info.model_dump())
        return info

    @staticmethod
    def _parse_period(periods: list[dict], date: datetime.date) -> WeatherInfo:
        match = next((p for p in periods
                      if p["startTime"].startswith(date.isoformat())), periods[0])
        temp_f = match["temperature"]
        temp_c = (temp_f - 32) * 5 / 9 if match.get("temperatureUnit") == "F" else temp_f
        pop = (match.get("probabilityOfPrecipitation") or {}).get("value") or 0
        return WeatherInfo(condition=match["shortForecast"],
                           temp_c=round(temp_c, 1),
                           precipitation_mm=float(pop) / 10.0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_weather_noaa.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/weather_noaa.py backend/tests/test_weather_noaa.py
git commit -m "feat: add NOAA weather adapter with cache and fallback"
```

---

### Task 8: Holiday adapter

**Files:**
- Create: `backend/wastewise/adapters/holidays.py`
- Test: `backend/tests/test_holidays.py`

**Interfaces:**
- Consumes: `Holiday` (Task 1).
- Produces: `USHolidays()` implementing `.get_holidays(start, end) -> list[Holiday]` using a small built-in 2026 US holiday table (no network — deterministic, avoids an external dependency for the MVP).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_holidays.py
import datetime
from wastewise.adapters.holidays import USHolidays


def test_returns_holiday_in_range():
    hs = USHolidays().get_holidays(datetime.date(2026, 7, 1), datetime.date(2026, 7, 10))
    names = {h.name for h in hs}
    assert "Independence Day" in names


def test_empty_when_no_holiday():
    hs = USHolidays().get_holidays(datetime.date(2026, 9, 8), datetime.date(2026, 9, 12))
    assert hs == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_holidays.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/adapters/holidays.py
import datetime
from wastewise.models import Holiday

_US_2026 = [
    (datetime.date(2026, 1, 1), "New Year's Day"),
    (datetime.date(2026, 5, 25), "Memorial Day"),
    (datetime.date(2026, 7, 4), "Independence Day"),
    (datetime.date(2026, 9, 7), "Labor Day"),
    (datetime.date(2026, 11, 26), "Thanksgiving"),
    (datetime.date(2026, 12, 25), "Christmas Day"),
]


class USHolidays:
    def get_holidays(self, start: datetime.date, end: datetime.date) -> list[Holiday]:
        return [Holiday(date=d, name=n) for d, n in _US_2026 if start <= d <= end]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_holidays.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/holidays.py backend/tests/test_holidays.py
git commit -m "feat: add US holiday adapter"
```

---

### Task 9: USDA wholesale price adapter

**Files:**
- Create: `backend/wastewise/adapters/price_usda.py`
- Test: `backend/tests/test_price_usda.py`

**Interfaces:**
- Consumes: `FileCache` (Task 6).
- Produces: `USDAWholesale(api_key: str, cache: FileCache, client: httpx.Client | None = None)` implementing `.get_wholesale_price(item) -> float | None`. Queries the MyMarketNews MARS API and returns the average `avgPrice` across returned rows for the item; returns `None` on error or no data.

> Note: MARS report schema varies by report; parsing is isolated in `_avg_price`. Verify the exact report id + field names against the live API on first run; the mock encodes the documented `results`/`avgPrice` shape.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_price_usda.py
import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_usda import USDAWholesale

BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports/2315"


@respx.mock
def test_get_wholesale_price_averages(tmp_path):
    body = {"results": [{"commodity": "CABBAGE", "avgPrice": "20.00"},
                        {"commodity": "CABBAGE", "avgPrice": "24.00"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = USDAWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("cabbage") == 22.0


@respx.mock
def test_get_wholesale_price_error_returns_none(tmp_path):
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(503))
    src = USDAWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("cabbage") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_price_usda.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/adapters/price_usda.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_price_usda.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/price_usda.py backend/tests/test_price_usda.py
git commit -m "feat: add USDA wholesale price adapter"
```

---

### Task 10: Kroger retail price adapter

**Files:**
- Create: `backend/wastewise/adapters/price_kroger.py`
- Test: `backend/tests/test_price_kroger.py`

**Interfaces:**
- Consumes: `SupplierPrice` (Task 1), `FileCache` (Task 6).
- Produces: `KrogerRetail(client_id, client_secret, cache, client=None)` implementing `.get_retail_prices(item, location) -> list[SupplierPrice]`. Fetches an OAuth token (client-credentials), then queries `/v1/products`; returns one `SupplierPrice(supplier="Kroger", unit_price=...)` using the item's promo-or-regular price. Returns `[]` on error.

> Note: token endpoint `https://api.kroger.com/v1/connect/oauth2/token`; products at `https://api.kroger.com/v1/products`. Price lives at `items[0].price.regular`. Parsing isolated in `_first_price`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_price_kroger.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_price_kroger.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/adapters/price_kroger.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_price_kroger.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/price_kroger.py backend/tests/test_price_kroger.py
git commit -m "feat: add Kroger retail price adapter"
```

---

### Task 11: LLM client wrapper

**Files:**
- Create: `backend/wastewise/agents/__init__.py`, `backend/wastewise/agents/llm.py`
- Test: `backend/tests/test_llm.py`

**Interfaces:**
- Produces:
  - `LLMClient(base_url, api_key, model, _openai=None)` with `.complete(system: str, user: str) -> str` (raw content). Uses the OpenAI-compatible `chat.completions` API. `_openai` allows injecting a fake client in tests.
  - `extract_json(text: str) -> list | dict` — pulls the first JSON array/object out of a model response (handles code fences); raises `ValueError` if none found.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm.py
import pytest
from wastewise.agents.llm import extract_json, LLMClient


def test_extract_json_from_fenced_block():
    text = 'Here you go:\n```json\n[{"item": "cabbage", "qty": 12}]\n```'
    assert extract_json(text) == [{"item": "cabbage", "qty": 12}]


def test_extract_json_raises_when_absent():
    with pytest.raises(ValueError):
        extract_json("no json here")


class _FakeCompletions:
    def create(self, **kwargs):
        class M:  # minimal shape of the OpenAI response
            choices = [type("C", (), {"message": type("Msg", (), {"content": "hi"})})]
        return M()


class _FakeOpenAI:
    def __init__(self): self.chat = type("Chat", (), {"completions": _FakeCompletions()})


def test_complete_returns_content():
    client = LLMClient("url", "key", "model", _openai=_FakeOpenAI())
    assert client.complete("sys", "user") == "hi"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_llm.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/agents/llm.py
import json
import re
from openai import OpenAI

_JSON_RE = re.compile(r"(\[.*\]|\{.*\})", re.DOTALL)


def extract_json(text: str):
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    match = _JSON_RE.search(candidate)
    if not match:
        raise ValueError("no JSON found in model output")
    return json.loads(match.group(1))


class LLMClient:
    def __init__(self, base_url: str, api_key: str, model: str, _openai=None):
        self.model = model
        self.client = _openai or OpenAI(base_url=base_url, api_key=api_key)

    def complete(self, system: str, user: str) -> str:
        resp = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            temperature=0.2,
        )
        return resp.choices[0].message.content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_llm.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/__init__.py backend/wastewise/agents/llm.py backend/tests/test_llm.py
git commit -m "feat: add OpenAI-compatible LLM client wrapper"
```

---

### Task 12: Adjustment agent

**Files:**
- Create: `backend/wastewise/agents/adjustment.py`
- Test: `backend/tests/test_adjustment.py`

**Interfaces:**
- Consumes: `ForecastItem`, `AdjustedItem`, `WeatherInfo`, `Holiday` (Task 1); `LLMClient`, `extract_json` (Task 11).
- Produces: `adjust_forecast(items: list[ForecastItem], weather: WeatherInfo, holidays: list[Holiday], llm) -> list[AdjustedItem]`. Builds one prompt, expects a JSON list of `{item, adjusted_qty, reason}`, validates each against the item set. **Fallback:** on any error/missing item, returns that item unchanged with `adjusted_qty = recommended_purchase_qty` and `reason = "No adjustment applied."`. `llm` is any object with `.complete(system, user) -> str`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_adjustment.py
from wastewise.models import ForecastItem, WeatherInfo, Holiday, AdjustedItem
from wastewise.agents.adjustment import adjust_forecast


def _items():
    return [ForecastItem(item="chicken", forecast=100, baseline=95,
                         safety_buffer=15, recommended_purchase_qty=115)]


class _FakeLLM:
    def __init__(self, out): self.out = out
    def complete(self, system, user): return self.out


def test_applies_valid_adjustment():
    llm = _FakeLLM('[{"item": "chicken", "adjusted_qty": 98, "reason": "Rain forecast"}]')
    out = adjust_forecast(_items(), WeatherInfo(condition="Rain", temp_c=15,
                          precipitation_mm=8), [], llm)
    assert out[0].adjusted_qty == 98
    assert "rain" in out[0].reason.lower()


def test_fallback_on_bad_json():
    llm = _FakeLLM("not json")
    out = adjust_forecast(_items(), WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], llm)
    assert out[0].adjusted_qty == 115  # unchanged recommended qty
    assert out[0].reason == "No adjustment applied."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_adjustment.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/agents/adjustment.py
from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing assistant. Given per-item recommended "
    "purchase quantities plus weather and holidays, adjust each quantity up or "
    "down and give a one-sentence reason. Respond ONLY with a JSON array of "
    '{"item": str, "adjusted_qty": number, "reason": str}. Reply in English.'
)


def _fallback(items: list[ForecastItem]) -> list[AdjustedItem]:
    return [AdjustedItem(item=i.item, forecast=i.forecast,
                         adjusted_qty=i.recommended_purchase_qty,
                         reason="No adjustment applied.") for i in items]


def adjust_forecast(items: list[ForecastItem], weather: WeatherInfo,
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"
    lines = "\n".join(f"- {i.item}: recommended {i.recommended_purchase_qty}"
                      for i in items)
    user = (f"Weather: {weather.condition}, {weather.temp_c}C, "
            f"precip {weather.precipitation_mm}mm. Holidays: {holiday_txt}.\n"
            f"Items:\n{lines}")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        by_item = {p["item"]: p for p in parsed}
    except (ValueError, KeyError, TypeError):
        return _fallback(items)

    out: list[AdjustedItem] = []
    for i in items:
        p = by_item.get(i.item)
        try:
            out.append(AdjustedItem(item=i.item, forecast=i.forecast,
                                    adjusted_qty=float(p["adjusted_qty"]),
                                    reason=str(p["reason"])))
        except (TypeError, KeyError, ValueError):
            out.append(AdjustedItem(item=i.item, forecast=i.forecast,
                                    adjusted_qty=i.recommended_purchase_qty,
                                    reason="No adjustment applied."))
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_adjustment.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/adjustment.py backend/tests/test_adjustment.py
git commit -m "feat: add adjustment agent with fallback"
```

---

### Task 13: Sourcing agent

**Files:**
- Create: `backend/wastewise/agents/sourcing.py`
- Test: `backend/tests/test_sourcing.py`

**Interfaces:**
- Consumes: `SupplierPrice`, `POLine`, `SourcingResponse` (Task 1); `LLMClient`/`extract_json` (Task 11); `WholesaleSource`/`RetailSource` protocols (Task 6).
- Produces: `source_order(items: list[dict], wholesale, retail, llm, location: str) -> SourcingResponse` where each `items` element is `{"item": str, "qty": float}`. For each item it fetches wholesale + retail prices, then asks the LLM to write a one-line `note` comparing retail vs benchmark. **Supplier/price selection is deterministic** (cheapest retail; if none, `supplier="Market"` at the wholesale price). `savings = Σ(wholesale − unit_price) * qty` for lines priced under benchmark (clamped at ≥ 0). LLM only writes the note; on LLM failure the note falls back to a computed string.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_sourcing.py
from wastewise.models import SupplierPrice
from wastewise.agents.sourcing import source_order


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.5)]


class _FakeLLM:
    def complete(self, system, user): return "Kroger is below market."


def test_source_order_picks_cheapest_and_computes_savings():
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc")
    line = resp.lines[0]
    assert line.supplier == "Kroger"
    assert line.unit_price == 1.5
    assert line.line_total == 15.0
    assert resp.total == 15.0
    assert resp.savings == 5.0  # (2.0-1.5)*10


class _NoRetail:
    def get_retail_prices(self, item, location): return []


def test_source_order_falls_back_to_market_when_no_retail():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_sourcing.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/agents/sourcing.py
from wastewise.models import POLine, SourcingResponse

SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the market benchmark. Respond with plain text only.")


def _note(llm, item: str, unit_price: float, benchmark: float | None) -> str:
    try:
        return llm.complete(
            SYSTEM,
            f"Item {item}: chosen price {unit_price}, benchmark {benchmark}.").strip()
    except Exception:
        if benchmark and unit_price < benchmark:
            pct = round((benchmark - unit_price) / benchmark * 100)
            return f"{pct}% under market benchmark."
        return "At or above market benchmark."


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str) -> SourcingResponse:
    lines: list[POLine] = []
    total = 0.0
    savings = 0.0
    for entry in items:
        item, qty = entry["item"], float(entry["qty"])
        benchmark = wholesale.get_wholesale_price(item)
        offers = retail.get_retail_prices(item, location)
        if offers:
            best = min(offers, key=lambda p: p.unit_price)
            supplier, unit_price = best.supplier, best.unit_price
        else:
            supplier = "Market"
            unit_price = benchmark if benchmark is not None else 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=_note(llm, item, unit_price, benchmark)))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_sourcing.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "feat: add sourcing agent with deterministic selection"
```

---

### Task 14: Pipeline orchestrator

**Files:**
- Create: `backend/wastewise/pipeline.py`
- Test: `backend/tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `run_forecast(records, horizon, location, weather_src, holiday_src, llm) -> ForecastResponse` where `horizon` is `"day"` or `"week"` (mapped to 1 / 7 days). It forecasts, fetches weather for the first future date + holidays over the horizon, and runs the adjustment agent.
  - `run_sourcing(items, location, wholesale_src, retail_src, llm) -> SourcingResponse` (thin wrapper over `source_order`).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline.py
from wastewise.models import WeatherInfo, SupplierPrice
from wastewise.pipeline import run_forecast, run_sourcing


class _Weather:
    def get_weather(self, date, location):
        return WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)


class _Holidays:
    def get_holidays(self, start, end): return []


class _LLM:
    def complete(self, system, user): return "note"


def test_run_forecast_returns_adjusted_items(sample_sales):
    resp = run_forecast(sample_sales, "week", "40.7,-74.0", _Weather(), _Holidays(), _LLM())
    assert {i.item for i in resp.items} == {"cabbage", "pork"}
    assert 0.0 <= resp.baseline_delta <= 1.0


class _Wholesale:
    def get_wholesale_price(self, item): return 2.0


class _Retail:
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.0)]


def test_run_sourcing_wraps_source_order():
    resp = run_sourcing([{"item": "cabbage", "qty": 3}], "loc",
                        _Wholesale(), _Retail(), _LLM())
    assert resp.total == 3.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pipeline.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/pipeline.py
import datetime
from wastewise.models import ForecastResponse, SourcingResponse, SalesRecord
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order

_HORIZON = {"day": 1, "week": 7}


def run_forecast(records: list[SalesRecord], horizon: str, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
    horizon_days = _HORIZON[horizon]
    items, delta = forecast_items(records, horizon_days)
    last_day = max(r.date for r in records)
    first_future = last_day + datetime.timedelta(days=1)
    weather = weather_src.get_weather(first_future, location)
    holidays = holiday_src.get_holidays(
        first_future, last_day + datetime.timedelta(days=horizon_days))
    adjusted = adjust_forecast(items, weather, holidays, llm)
    return ForecastResponse(items=adjusted, baseline_delta=delta)


def run_sourcing(items: list[dict], location: str, wholesale_src, retail_src,
                 llm) -> SourcingResponse:
    return source_order(items, wholesale_src, retail_src, llm, location)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pipeline.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/pipeline.py backend/tests/test_pipeline.py
git commit -m "feat: add pipeline orchestrator"
```

---

### Task 15: FastAPI app + endpoints + CORS

**Files:**
- Create: `backend/wastewise/api.py`
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Consumes: everything above + `get_settings` (Task 0).
- Produces: `app` (FastAPI) with the four endpoints from the API contract. A `build_dependencies(settings)` factory constructs the concrete adapters + `LLMClient` + `DatasetStore`, so tests can override it. Endpoints:
  - `GET /health` → `{"status": "ok"}`
  - `POST /upload` (multipart `file`) → `{"dataset_id", "summary"}`
  - `POST /forecast` (JSON body `ForecastRequest`) → `ForecastResponse`
  - `POST /sourcing` (JSON body `SourcingRequest`) → `SourcingResponse`
- Request models: `ForecastRequest(dataset_id: str, horizon: str = "week", location: str = "40.7,-74.0")`, `SourcingRequest(items: list[dict], location: str = "40.7,-74.0")`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: wastewise.api`.

- [ ] **Step 3: Write minimal implementation**

```python
# wastewise/api.py
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from wastewise.config import get_settings
from wastewise.storage import DatasetStore
from wastewise.ingest import parse_sales_csv, summarize
from wastewise.pipeline import run_forecast, run_sourcing
from wastewise.adapters.base import FileCache
from wastewise.adapters.weather_noaa import NOAAWeather
from wastewise.adapters.holidays import USHolidays
from wastewise.adapters.price_usda import USDAWholesale
from wastewise.adapters.price_kroger import KrogerRetail
from wastewise.agents.llm import LLMClient

app = FastAPI(title="WasteWise")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


def get_deps() -> dict:
    s = get_settings()
    cache = FileCache(s.cache_dir)
    return {
        "store": DatasetStore(s.db_path),
        "weather": NOAAWeather(cache),
        "holidays": USHolidays(),
        "wholesale": USDAWholesale(s.usda_api_key, cache),
        "retail": KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache),
        "llm": LLMClient(s.llm_base_url, s.llm_api_key, s.llm_model),
    }


class ForecastRequest(BaseModel):
    dataset_id: str
    horizon: str = "week"
    location: str = "40.7,-74.0"


class SourcingRequest(BaseModel):
    items: list[dict]
    location: str = "40.7,-74.0"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...), deps: dict = Depends(get_deps)):
    text = (await file.read()).decode("utf-8")
    try:
        records = parse_sales_csv(text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    ds_id = deps["store"].save(records)
    return {"dataset_id": ds_id, "summary": summarize(ds_id, records).model_dump(mode="json")}


@app.post("/forecast")
def forecast(req: ForecastRequest, deps: dict = Depends(get_deps)):
    try:
        records = deps["store"].load(req.dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="dataset not found")
    return run_forecast(records, req.horizon, req.location,
                        deps["weather"], deps["holidays"], deps["llm"])


@app.post("/sourcing")
def sourcing(req: SourcingRequest, deps: dict = Depends(get_deps)):
    return run_sourcing(req.items, req.location, deps["wholesale"],
                        deps["retail"], deps["llm"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/api.py backend/tests/test_api.py
git commit -m "feat: add FastAPI endpoints for upload, forecast, sourcing"
```

---

### Task 16: Full-pipeline integration test + AMD-usage docs

**Files:**
- Create: `backend/tests/test_integration.py`, `docs/AMD_USAGE.md`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `app`, demo dataset from Task 3.

- [ ] **Step 1: Write the integration test (uploads the bundled demo CSV, runs all three steps with fake external deps)**

```python
# tests/test_integration.py
import io
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
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `pytest tests/test_integration.py -v`
Expected: PASS (the pieces already exist). If it fails, fix the failing unit — do not weaken the test.

- [ ] **Step 3: Run the whole suite**

Run: `pytest -q`
Expected: all tests pass.

- [ ] **Step 4: Write `docs/AMD_USAGE.md`** (repo root `docs/`) documenting how inference runs on AMD, for hackathon pre-screening:

```markdown
# AMD Compute Usage

WasteWise runs both LLM judgment steps (demand adjustment + sourcing notes) on an
open model served by **vLLM on an AMD Instinct MI300X (ROCm)** via an
OpenAI-compatible endpoint. Set `LLM_BASE_URL` to the vLLM endpoint at submission
time. Serve with:

    vllm serve <model> --port 8000

Insert a screenshot of `rocm-smi` showing the model resident on the MI300X, and a
screenshot of the vLLM server log, below this line.
```

- [ ] **Step 5: Append a "Run locally" section to `backend/README.md`**

```markdown
## Run locally
    pip install -e ".[dev]"
    cp .env.example .env   # fill in keys; point LLM_BASE_URL at vLLM or Fireworks
    uvicorn wastewise.api:app --reload
Tests: `pytest -q`
```

- [ ] **Step 6: Commit**

```bash
git add backend/tests/test_integration.py docs/AMD_USAGE.md backend/README.md
git commit -m "test: add end-to-end integration test and AMD usage docs"
```

---

## Self-Review

**Spec coverage:**
- Forecast engine (XGBoost + baseline + delta) → Tasks 4–5 ✓
- Item-level purchase mechanic (forecast + buffer) → Task 5 ✓
- Adjustment agent (weather/holiday, structured JSON, fallback) → Task 12 ✓
- Sourcing agent (USDA vs Kroger, deterministic pick, LLM note, savings) → Task 13 ✓
- Swappable adapters + cache → Tasks 6–10 ✓
- LLM behind OpenAI-compatible client, env-driven, vLLM/Fireworks swap → Tasks 0, 11 ✓
- Error handling (API down → cache/neutral; bad JSON → fallback; forecaster → baseline in delta) → Tasks 7, 9, 10, 12 ✓
- API contract (/health, /upload, /forecast, /sourcing) → Task 15 ✓
- SQLite storage → Task 2 ✓
- Config/secrets in .env, not committed → Tasks 0 (.gitignore, .env.example) ✓
- English-only prompts → Tasks 12–13 system prompts ✓
- MIT license → Task 0 ✓
- AMD-usage documented in repo (pre-screening) → Tasks 0, 16 ✓
- Demo dataset + pre-cacheable external calls → Tasks 3, 6 (cache) ✓
- **Deferred to Plan 2 (frontend):** Next.js 4 screens, Vercel deploy, slide deck, demo video, pre-caching demo responses to disk for the live demo (the cache mechanism exists here; populating it for the demo is a Plan-2 step).

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `ForecastItem`, `AdjustedItem`, `POLine`, `SourcingResponse`, `WeatherInfo`, `Holiday`, `SupplierPrice` names/fields are consistent across Tasks 1, 5, 12, 13, 14, 15. `get_deps` override key matches between Tasks 15 and 16. `llm.complete(system, user)` signature is consistent across Tasks 11–16.

---

## Notes for the implementer / known real-world checks

- **External API schemas (USDA MARS, Kroger, NOAA) may differ slightly from the mocks.** Each adapter isolates parsing in a small helper (`_avg_price`, `_first_price`, `_parse_period`). On first live run, verify field names and adjust *only* that helper; the tests pin the documented shapes.
- **XGBoost on small data** is fine for the demo; the `baseline_delta` may be modest or 0.0 on some datasets — that is acceptable and honest.
- **Latency:** the forecast step makes 1 LLM call; sourcing makes 1 per item. If item counts are high, batch the sourcing notes into a single call to stay under 30s (optimization, not required for the demo dataset of 3 items).
