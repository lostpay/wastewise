# Gap-Analysis Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seven gaps from the 2026-07-11 readiness review: visible demo-mode labeling, item/holiday features in the forecaster, full-horizon weather for the adjustment agent, a measured waste-avoided metric (backend + stat tile), package units surfaced through sourcing, editable PO quantities, and a history-vs-forecast chart.

**Architecture:** Backend changes extend the existing forecaster/pipeline/agent modules in place (new pydantic fields all get defaults so stored wizard state and old fixtures stay valid). Frontend changes follow the existing wizard-store pattern: new state fields flow through `useWizard`, demo fixtures in `lib/demo.ts` mirror every new backend field.

**Tech Stack:** FastAPI + pydantic + XGBoost + pandas (backend, pytest); Next.js App Router + Recharts + vitest/@testing-library (frontend).

## Global Constraints

- **Do not start until the hackathon submission is recorded.** Work on a fresh branch off `main` (e.g. `feat/gap-analysis-improvements`), not on the submission branch./usa
- Backend tests run from `backend/`: `./.venv/Scripts/python.exe -m pytest -q` (Git Bash on Windows). Run the full suite at the end of every task, not just the new test file.
- Frontend tests run from `frontend/`: `npx vitest run` (full) or `npx vitest run __tests__/<file>` (single). Type check: `npx tsc --noEmit`.
- Every new pydantic/TypeScript field must have a default (`= 0.0`, `= []`, `?:`) — persisted sessionStorage state and demo fixtures from before the change must still validate.
- Never regress the two honesty mechanisms: the `live` flag semantics (True only on a real LLM success path) and the demo-mode fallback (`lib/api.ts` must keep returning fixtures on connectivity failure/5xx).
- All UI copy in English. Match existing code style: comments only for non-obvious constraints, conventional-commit messages with no trailers (match `git log`).
- Frontend note per `frontend/AGENTS.md`: this Next.js version may differ from training data — check `node_modules/next/dist/docs/` before using unfamiliar Next.js APIs (the tasks below only use React + Recharts, no new Next.js APIs).

---

### Task 1: Demo-mode banner

The frontend silently serves canned fixtures when the backend is unreachable (`lib/api.ts` `call()`); nothing on screen says so. Add a session-scoped "demo data served" flag, set it on every fixture-serving path, and render a banner under the header.

**Files:**
- Modify: `frontend/lib/demo.ts`
- Modify: `frontend/lib/api.ts:15-27`
- Create: `frontend/components/demo-banner.tsx`
- Modify: `frontend/app/layout.tsx:33-58`
- Modify: `frontend/app/setup/page.tsx:31-38`
- Test: `frontend/__tests__/demo-banner.test.tsx` (new)

**Interfaces:**
- Produces: `markDemoServed(): void`, `clearDemoServed(): void`, `demoWasServed(): boolean` in `lib/demo.ts`; `<DemoBanner />` client component. Window events `"ww:demo-served"` / `"ww:demo-cleared"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/demo-banner.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/demo-banner";
import { markDemoServed, clearDemoServed, demoWasServed } from "@/lib/demo";

describe("DemoBanner", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("renders nothing until demo data has been served", () => {
    render(<DemoBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears when a demo fixture is served and disappears on clear", () => {
    render(<DemoBanner />);
    act(() => markDemoServed());
    expect(screen.getByRole("status")).toHaveTextContent(/demo data/i);
    act(() => clearDemoServed());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tracks served state in sessionStorage", () => {
    expect(demoWasServed()).toBe(false);
    markDemoServed();
    expect(demoWasServed()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run __tests__/demo-banner.test.tsx`
Expected: FAIL — cannot resolve `@/components/demo-banner` / `markDemoServed` not exported.

- [ ] **Step 3: Implement**

Append to `frontend/lib/demo.ts` (below `isDemoMode`):

```ts
const SERVED_KEY = "ww_demo_served";

export function markDemoServed(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SERVED_KEY, "1");
  window.dispatchEvent(new Event("ww:demo-served"));
}

export function clearDemoServed(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SERVED_KEY);
  window.dispatchEvent(new Event("ww:demo-cleared"));
}

export function demoWasServed(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(SERVED_KEY) === "1";
}
```

In `frontend/lib/api.ts`, import `markDemoServed` and mark every fixture-serving path:

```ts
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE, isDemoMode, markDemoServed } from "./demo";

async function call<T>(path: string, init: RequestInit, demo: T): Promise<T> {
  if (isDemoMode()) {
    markDemoServed();
    return demo;
  }
  let res: Response;
  try {
    res = await fetch(base() + path, init);
  } catch {
    markDemoServed();
    return demo; // connectivity failure -> demo fallback
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status >= 500) {
    markDemoServed();
    return demo; // server/upstream down -> demo fallback
  }
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, (body as { detail?: string }).detail ?? `Request failed (${res.status})`);
}
```

Create `frontend/components/demo-banner.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { demoWasServed } from "@/lib/demo";

export function DemoBanner() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const sync = () => setShown(demoWasServed());
    sync();
    window.addEventListener("ww:demo-served", sync);
    window.addEventListener("ww:demo-cleared", sync);
    return () => {
      window.removeEventListener("ww:demo-served", sync);
      window.removeEventListener("ww:demo-cleared", sync);
    };
  }, []);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-700/30 bg-amber-100 px-6 py-2 text-center font-mono text-[11px] uppercase tracking-widest text-amber-900"
    >
      Demo data — figures below are canned fixtures, not live model output
    </div>
  );
}
```

In `frontend/app/layout.tsx`: import `DemoBanner` and render it directly after the closing `</header>` tag (before the wizard grid `<div>`):

```tsx
import { DemoBanner } from "@/components/demo-banner";
```
```tsx
          </header>
          <DemoBanner />
```

In `frontend/app/setup/page.tsx`: the mount-time reset effect already calls `setDemoMode(false)`; also clear the served flag so the banner drops when the user starts over. Update the import and the effect body:

```tsx
import { setDemoMode, clearDemoServed } from "@/lib/demo";
```
```tsx
    if (datasetId) {
      setDemoMode(false);
      clearDemoServed();
      set({ datasetId: null, summary: null, forecast: null, sourcing: null, rationale: null });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run __tests__/demo-banner.test.tsx`
Expected: PASS (3 tests). Then `npx vitest run && npx tsc --noEmit` — all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/demo.ts frontend/lib/api.ts frontend/components/demo-banner.tsx frontend/app/layout.tsx frontend/app/setup/page.tsx frontend/__tests__/demo-banner.test.tsx
git commit -m "feat: visibly label demo data whenever fixtures are served"
```

---

### Task 2: Item identity and holiday features in the forecaster

The pooled XGBoost model has no item feature — two items with identical lag values get identical predictions — and no holiday flag despite the design spec listing one. Add `item_code` and `is_holiday` features and fetch holidays before forecasting.

**Files:**
- Modify: `backend/wastewise/forecasting/features.py`
- Modify: `backend/wastewise/forecasting/forecaster.py`
- Modify: `backend/wastewise/pipeline.py:11-21`
- Test: `backend/tests/test_forecaster.py`, `backend/tests/test_pipeline.py`

**Interfaces:**
- Consumes: `USHolidays.get_holidays(start: date, end: date) -> list[Holiday]` (existing adapter, works for any 2026 range).
- Produces: `build_frame(records, holiday_dates: frozenset[datetime.date] = frozenset())`; `forecast_items(records, horizon_days, safety_frac=0.15, holiday_dates=frozenset()) -> tuple[list[ForecastItem], float]` (return type unchanged in this task); `FEATURES` now includes `"item_code"` and `"is_holiday"`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_forecaster.py` (and extend the existing feature-list test):

```python
import datetime


def test_build_frame_has_features(sample_sales):
    df = build_frame(sample_sales)
    for col in ["dow", "weekofyear", "month", "lag7", "roll7", "item_code", "is_holiday"]:
        assert col in df.columns


def test_item_codes_distinguish_items(sample_sales):
    df = build_frame(sample_sales)
    assert (df.groupby("item")["item_code"].nunique() == 1).all()
    assert df["item_code"].nunique() == 2


def test_holiday_flag_marks_holiday_dates(sample_sales):
    memorial_day = datetime.date(2026, 5, 25)
    df = build_frame(sample_sales, frozenset({memorial_day}))
    flagged = set(df[df["is_holiday"] == 1]["date"].dt.date)
    assert flagged == {memorial_day}
    assert (df[df["is_holiday"] == 0]["date"].dt.date != memorial_day).all()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_forecaster.py -q`
Expected: FAIL — `item_code` not in columns / unexpected `holiday_dates` argument.

- [ ] **Step 3: Implement the features**

Replace `backend/wastewise/forecasting/features.py`:

```python
# wastewise/forecasting/features.py
import datetime
import pandas as pd
from wastewise.models import SalesRecord


def build_frame(records: list[SalesRecord],
                holiday_dates: frozenset[datetime.date] = frozenset()) -> pd.DataFrame:
    df = pd.DataFrame([{"date": r.date, "item": r.item, "quantity": r.quantity}
                       for r in records])
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["item", "date"]).reset_index(drop=True)
    df["dow"] = df["date"].dt.dayofweek
    df["weekofyear"] = df["date"].dt.isocalendar().week.astype(int)
    df["month"] = df["date"].dt.month
    df["item_code"] = df["item"].astype("category").cat.codes
    df["is_holiday"] = df["date"].dt.date.isin(holiday_dates).astype(int)
    df["lag7"] = df.groupby("item")["quantity"].shift(7)
    df["roll7"] = (df.groupby("item")["quantity"]
                     .shift(1).rolling(7).mean().reset_index(level=0, drop=True))
    return df
```

In `backend/wastewise/forecasting/forecaster.py`:

```python
FEATURES = ["dow", "weekofyear", "month", "lag7", "roll7", "item_code", "is_holiday"]
```

```python
def _future_rows(df_item: pd.DataFrame, horizon_days: int,
                 holiday_dates: frozenset) -> pd.DataFrame:
    """Build feature rows for the next horizon_days for a single item."""
    last_date = df_item["date"].max()
    recent_mean = df_item["quantity"].tail(7).mean()
    item_code = int(df_item["item_code"].iloc[0])
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
            "item_code": item_code,
            "is_holiday": 1 if d.date() in holiday_dates else 0,
        })
    return pd.DataFrame(rows)
```

```python
def forecast_items(records: list[SalesRecord], horizon_days: int,
                   safety_frac: float = 0.15,
                   holiday_dates: frozenset = frozenset()) -> tuple[list[ForecastItem], float]:
    df = build_frame(records, holiday_dates)
    model = _train(df)
    items: list[ForecastItem] = []
    for item, g in df.groupby("item"):
        future = _future_rows(g, horizon_days, holiday_dates)
        pred = float(np.clip(model.predict(future[FEATURES]).sum(), 0, None))
        base = baseline_forecast(records, item, horizon_days)
        buffer = safety_frac * pred
        items.append(ForecastItem(item=item, forecast=round(pred, 2),
                                  baseline=round(base, 2),
                                  safety_buffer=round(buffer, 2),
                                  recommended_purchase_qty=round(pred + buffer, 2)))
    delta = _backtest_delta(records, df)
    return items, delta
```

In `backend/wastewise/pipeline.py`, fetch holidays over history + horizon *before* forecasting (`run_forecast` becomes):

```python
def run_forecast(records: list[SalesRecord], horizon: str, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
    horizon_days = _HORIZON[horizon]
    first_hist = min(r.date for r in records)
    last_day = max(r.date for r in records)
    first_future = last_day + datetime.timedelta(days=1)
    horizon_end = last_day + datetime.timedelta(days=horizon_days)
    # Holidays span the full history so the model can learn from past holiday
    # spikes, not just flag the upcoming ones.
    holidays = holiday_src.get_holidays(first_hist, horizon_end)
    holiday_dates = frozenset(h.date for h in holidays)
    items, delta = forecast_items(records, horizon_days, holiday_dates=holiday_dates)
    weather = weather_src.get_weather(first_future, location)
    future_holidays = [h for h in holidays if h.date >= first_future]
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    return ForecastResponse(items=adjusted, baseline_delta=delta)
```

Update `backend/tests/test_pipeline.py` so the holiday stub records its call window and the test asserts history coverage:

```python
class _Holidays:
    def __init__(self):
        self.calls = []

    def get_holidays(self, start, end):
        self.calls.append((start, end))
        return []


def test_run_forecast_returns_adjusted_items(sample_sales):
    holidays = _Holidays()
    resp = run_forecast(sample_sales, "week", "40.7,-74.0", _Weather(), holidays, _LLM())
    assert {i.item for i in resp.items} == {"cabbage", "pork"}
    assert 0.0 <= resp.baseline_delta <= 1.0
    # holiday window must cover the sales history, not just the future horizon
    start, end = holidays.calls[0]
    assert start == min(r.date for r in sample_sales)
    assert end == max(r.date for r in sample_sales) + datetime.timedelta(days=7)
```

(add `import datetime` at the top of `test_pipeline.py`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all pass (the full suite — `test_ingest`, `test_api`, etc. exercise `build_frame` indirectly).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/forecasting/features.py backend/wastewise/forecasting/forecaster.py backend/wastewise/pipeline.py backend/tests/test_forecaster.py backend/tests/test_pipeline.py
git commit -m "feat: add item identity and holiday features to the forecaster"
```

---

### Task 3: Full-horizon weather for the adjustment agent

A week-horizon order is currently adjusted on day-1 weather only (`pipeline.py` fetches a single date). Fetch every horizon day and give the agent a day-by-day summary.

**Files:**
- Modify: `backend/wastewise/pipeline.py` (the `run_forecast` body from Task 2)
- Modify: `backend/wastewise/agents/adjustment.py`
- Test: `backend/tests/test_adjustment.py`, `backend/tests/test_pipeline.py`

**Interfaces:**
- Produces: `adjust_forecast(items, weather: list[tuple[datetime.date, WeatherInfo]], holidays, llm) -> list[AdjustedItem]` — **signature change**: `weather` becomes a list of `(date, WeatherInfo)` pairs, one per horizon day.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_adjustment.py`, add `import datetime` at the top, define a helper, and update every `adjust_forecast(...)` call to pass a list. The existing single-day calls become:

```python
import datetime


def _one_day(w):
    return [(datetime.date(2026, 7, 13), w)]
```

- `test_adjusts_each_item_with_genuinely_different_reasoning`: `adjust_forecast(_items(), _one_day(weather), [], _PerItemLLM())`
- `test_fallback_on_bad_json_marks_not_live`: `adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)), [], _BadJsonLLM())`
- `test_one_items_failure_does_not_affect_another_items_success`: `adjust_forecast(_items(), _one_day(WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)), [], _MixedLLM())`
- `test_fallback_on_llm_transport_error`: `adjust_forecast(items, _one_day(WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)), [], _RaisingLLM())`

Then add the new behavior test (2026-07-13 is a Monday):

```python
class _CaptureLLM:
    def __init__(self):
        self.prompts = []

    def complete(self, system, user):
        self.prompts.append(user)
        return '{"adjusted_qty": 100, "reason": "ok"}'


def test_prompt_includes_every_horizon_day():
    weather = [
        (datetime.date(2026, 7, 13), WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)),
        (datetime.date(2026, 7, 14), WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)),
    ]
    llm = _CaptureLLM()
    adjust_forecast(_items(), weather, [], llm)
    assert "Mon Jul 13" in llm.prompts[0]
    assert "Tue Jul 14" in llm.prompts[0]
    assert "Rain" in llm.prompts[0] and "Clear" in llm.prompts[0]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_adjustment.py -q`
Expected: FAIL — `_adjust_one` formats `weather.condition` on a list / new test missing day names.

- [ ] **Step 3: Implement**

In `backend/wastewise/agents/adjustment.py`, add `import datetime`, adjust the SYSTEM prompt's first sentences, and thread a pre-built weather summary:

```python
SYSTEM = (
    "You are a restaurant purchasing assistant. You are given ONE item's "
    "recommended purchase quantity plus the day-by-day weather for the "
    "purchasing horizon and its holidays. Adjust the quantity up or down "
    "based on how the weather pattern and holidays specifically affect THIS "
    "item's category, and give a one-sentence reason. The same weather "
    "condition affects different item categories differently -- never reuse "
    "a generic reason across items.\n\n"
    ...  # keep the three few-shot examples and the JSON instruction unchanged
)
```

```python
def _weather_text(weather: list[tuple[datetime.date, WeatherInfo]]) -> str:
    return "; ".join(
        f"{d.strftime('%a %b %d')}: {w.condition}, {w.temp_c}C, precip {w.precipitation_mm}mm"
        for d, w in weather)


def _adjust_one(item: ForecastItem, weather_txt: str, holiday_txt: str, llm) -> AdjustedItem:
    user = (f"Weather: {weather_txt}. Holidays: {holiday_txt}.\n"
            f"Item: {item.item}, recommended quantity: {item.recommended_purchase_qty}.")
    ...  # try/except body unchanged


def adjust_forecast(items: list[ForecastItem],
                    weather: list[tuple[datetime.date, WeatherInfo]],
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"
    weather_txt = _weather_text(weather)

    def _adjust_one_partial(item):
        return _adjust_one(item, weather_txt, holiday_txt, llm)

    # One call per item, run concurrently -- each item only sees its own name
    # and quantity, so the model structurally cannot copy-paste reasoning
    # across items regardless of prompt wording (see SYSTEM above).
    with ThreadPoolExecutor(max_workers=min(8, len(items)) or 1) as pool:
        return list(pool.map(_adjust_one_partial, items))
```

In `backend/wastewise/pipeline.py` `run_forecast`, replace the single fetch:

```python
    weather = [(first_future + datetime.timedelta(days=i),
                weather_src.get_weather(first_future + datetime.timedelta(days=i), location))
               for i in range(horizon_days)]
```

(NOAA responses are cached per `(location, date)` by the adapter, so this is at most 7 cheap calls; dates past the NWS forecast window fall back to the adapter's first period.)

Update `backend/tests/test_pipeline.py` `_Weather` to count calls and assert one per horizon day:

```python
class _Weather:
    def __init__(self):
        self.calls = 0

    def get_weather(self, date, location):
        self.calls += 1
        return WeatherInfo(condition="Clear", temp_c=25, precipitation_mm=0)
```

and in `test_run_forecast_returns_adjusted_items`, construct `weather = _Weather()`, pass it, and add `assert weather.calls == 7`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/adjustment.py backend/wastewise/pipeline.py backend/tests/test_adjustment.py backend/tests/test_pipeline.py
git commit -m "feat: adjust forecasts on the full horizon's weather, not just day one"
```

---

### Task 4: Waste-avoided metric from the backtest (backend)

The app is named WasteWise but never quantifies waste. The 7-day holdout backtest already replays history; extend it to compare over-ordering under the baseline policy vs the model policy (both with the 15% safety buffer) and report the difference in units and — when the CSV has prices — dollars.

**Files:**
- Modify: `backend/wastewise/models.py:36-38`
- Modify: `backend/wastewise/forecasting/forecaster.py`
- Modify: `backend/wastewise/pipeline.py` (`run_forecast` return)
- Test: `backend/tests/test_forecaster.py`, `backend/tests/test_pipeline.py`

**Interfaces:**
- Produces: `BacktestStats(delta: float, waste_avoided_units: float, waste_avoided_value: float | None)` in `models.py`; `forecast_items(...) -> tuple[list[ForecastItem], BacktestStats]` — **return type change** (was `tuple[list[ForecastItem], float]`); `ForecastResponse` gains `waste_avoided_units: float = 0.0` and `waste_avoided_value: float | None = None`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_forecaster.py`, rename the unpacked `delta` to `stats` in the existing test and add two new ones:

```python
def test_forecast_items_returns_item_per_product(sample_sales):
    items, stats = forecast_items(sample_sales, horizon_days=7)
    names = {i.item for i in items}
    assert names == {"cabbage", "pork"}
    for it in items:
        assert isinstance(it, ForecastItem)
        assert it.forecast >= 0
        # recommended = forecast + 15% buffer
        assert abs(it.recommended_purchase_qty - it.forecast * 1.15) < 1e-6
    assert 0.0 <= stats.delta <= 1.0


def test_backtest_reports_waste_avoided_units(sample_sales):
    _, stats = forecast_items(sample_sales, horizon_days=7)
    assert stats.waste_avoided_units >= 0.0
    assert stats.waste_avoided_value is None  # sample_sales has no prices


def test_waste_avoided_value_present_when_prices_exist(sample_sales):
    priced = [r.model_copy(update={"price": 2.0}) for r in sample_sales]
    _, stats = forecast_items(priced, horizon_days=7)
    assert stats.waste_avoided_value is not None
    assert stats.waste_avoided_value >= 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_forecaster.py -q`
Expected: FAIL — `stats.delta` attribute error (a float comes back).

- [ ] **Step 3: Implement**

In `backend/wastewise/models.py`, add after `ForecastItem` and extend `ForecastResponse`:

```python
class BacktestStats(BaseModel):
    delta: float
    waste_avoided_units: float
    waste_avoided_value: float | None


class ForecastResponse(BaseModel):
    items: list[AdjustedItem]
    baseline_delta: float
    waste_avoided_units: float = 0.0
    waste_avoided_value: float | None = None
```

In `backend/wastewise/forecasting/forecaster.py`, import `BacktestStats`, change `forecast_items` to end with:

```python
    stats = _backtest(records, df, safety_frac)
    return items, stats
```

and replace `_backtest_delta` with:

```python
def _mean_prices(records: list[SalesRecord]) -> dict[str, float]:
    by_item: dict[str, list[float]] = {}
    for r in records:
        if r.price is not None:
            by_item.setdefault(r.item, []).append(r.price)
    return {item: float(np.mean(v)) for item, v in by_item.items()}


def _backtest(records: list[SalesRecord], df: pd.DataFrame,
              safety_frac: float) -> BacktestStats:
    """MAE improvement plus over-ordering avoided (model vs baseline policy,
    both buffered) over a 7-day holdout."""
    cutoff = df["date"].max() - pd.Timedelta(days=7)
    train_df = df[df["date"] <= cutoff]
    test_df = df[df["date"] > cutoff].dropna(subset=FEATURES)
    if len(train_df.dropna(subset=FEATURES)) < 20 or test_df.empty:
        return BacktestStats(delta=0.0, waste_avoided_units=0.0, waste_avoided_value=None)
    model = _train(train_df)
    prices = _mean_prices(records)
    model_err, base_err = [], []
    over_model = over_base = 0.0
    value_model = value_base = 0.0
    any_priced = False
    for _, row in test_df.iterrows():
        yhat = float(model.predict(row[FEATURES].to_frame().T.astype(float))[0])
        actual = row["quantity"]
        model_err.append(abs(yhat - actual))
        base_err.append(abs(row["lag7"] - actual))
        om = max(0.0, yhat * (1 + safety_frac) - actual)
        ob = max(0.0, row["lag7"] * (1 + safety_frac) - actual)
        over_model += om
        over_base += ob
        price = prices.get(row["item"])
        if price is not None:
            any_priced = True
            value_model += om * price
            value_base += ob * price
    m, b = float(np.mean(model_err)), float(np.mean(base_err))
    delta = 0.0 if b == 0 else float(np.clip((b - m) / b, 0.0, 1.0))
    units = round(max(0.0, over_base - over_model), 2)
    value = round(max(0.0, value_base - value_model), 2) if any_priced else None
    return BacktestStats(delta=delta, waste_avoided_units=units,
                         waste_avoided_value=value)
```

In `backend/wastewise/pipeline.py` `run_forecast`, unpack and forward:

```python
    items, stats = forecast_items(records, horizon_days, holiday_dates=holiday_dates)
    ...
    return ForecastResponse(items=adjusted, baseline_delta=stats.delta,
                            waste_avoided_units=stats.waste_avoided_units,
                            waste_avoided_value=stats.waste_avoided_value)
```

In `backend/tests/test_pipeline.py` `test_run_forecast_returns_adjusted_items`, add:

```python
    assert resp.waste_avoided_units >= 0.0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all pass (new `ForecastResponse` fields have defaults, so API/integration tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/forecasting/forecaster.py backend/wastewise/pipeline.py backend/tests/test_forecaster.py backend/tests/test_pipeline.py
git commit -m "feat: measure over-ordering avoided vs baseline in the holdout backtest"
```

---

### Task 5: Waste-avoided stat tile (frontend)

Surface Task 4's metric on the Forecast screen next to the accuracy tile.

**Files:**
- Modify: `frontend/lib/types.ts:24-27`
- Modify: `frontend/lib/demo.ts` (`DEMO_FORECAST`)
- Modify: `frontend/app/forecast/page.tsx:71-75`
- Test: `frontend/__tests__/forecast.test.tsx`

**Interfaces:**
- Consumes: `waste_avoided_units` / `waste_avoided_value` from Task 4's `ForecastResponse`.
- Produces: `ForecastResponse` TS interface gains `waste_avoided_units?: number; waste_avoided_value?: number | null;` (optional — stale persisted state must not break).

- [ ] **Step 1: Write the failing test**

Add to `frontend/__tests__/forecast.test.tsx`:

```tsx
  it("shows the waste-avoided tile when the backtest reports savings", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText(/\$61\.50/)).toBeInTheDocument();
    expect(screen.getByText(/over-ordering avoided/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run __tests__/forecast.test.tsx`
Expected: FAIL — `$61.50` not found.

- [ ] **Step 3: Implement**

`frontend/lib/types.ts`:

```ts
export interface ForecastResponse {
  items: ForecastAdjustedItem[];
  baseline_delta: number;
  waste_avoided_units?: number;
  waste_avoided_value?: number | null;
}
```

`frontend/lib/demo.ts` — add to `DEMO_FORECAST`:

```ts
export const DEMO_FORECAST: ForecastResponse = {
  baseline_delta: 0.18,
  waste_avoided_units: 34,
  waste_avoided_value: 61.5,
  items: [
    ...
```

`frontend/app/forecast/page.tsx` — wrap the existing `StatTile` in a two-column grid and add the second tile:

```tsx
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Forecast accuracy gain vs. simple seasonal baseline"
              value={`${Math.round(forecast.baseline_delta * 100)}%`}
              hint="Lower mean absolute error on a 7-day holdout vs. a naive same-weekday baseline. Higher is better."
            />
            {(forecast.waste_avoided_units ?? 0) > 0 ? (
              <StatTile
                label="Over-ordering avoided vs. baseline"
                value={
                  forecast.waste_avoided_value != null
                    ? `$${forecast.waste_avoided_value.toFixed(2)}`
                    : `${(forecast.waste_avoided_units ?? 0).toFixed(0)} units`
                }
                hint="Same 7-day holdout: what a naive same-weekday ordering policy would have over-bought, minus this model's over-buy — both with the 15% safety buffer."
              />
            ) : null}
          </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/demo.ts frontend/app/forecast/page.tsx frontend/__tests__/forecast.test.tsx
git commit -m "feat: surface over-ordering avoided as a stat tile on the forecast screen"
```

---

### Task 6: Package units surfaced through sourcing

`line_total = unit_price × qty` multiplies sales units by a per-package retail price with no unit shown. Kroger's product payload carries a `size` field — thread it through as `unit` and render it after prices.

**Files:**
- Modify: `backend/wastewise/models.py` (`SupplierPrice`, `POLine`)
- Modify: `backend/wastewise/adapters/price_kroger.py:92-105`
- Modify: `backend/wastewise/agents/sourcing.py:87-100`
- Modify: `frontend/lib/types.ts` (`POLine`), `frontend/lib/demo.ts` (`DEMO_SOURCING`), `frontend/components/po-table.tsx`, `frontend/components/price-table.tsx` (`PriceCell`), `frontend/lib/csv.ts`
- Test: `backend/tests/test_price_kroger.py`, `backend/tests/test_sourcing.py`, `frontend/__tests__/csv.test.ts`

**Interfaces:**
- Produces: `SupplierPrice.unit: str = ""`, `POLine.unit: str = ""` (backend); `POLine.unit?: string` (frontend). Kroger fills `unit` from `items[0]["size"]`; the chosen offer's `unit` is copied onto its PO line; non-offer lines keep `""`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_price_kroger.py`:

```python
def test_parse_prices_includes_package_size():
    payload = {"data": [{"description": "Green Cabbage",
                         "items": [{"price": {"regular": 1.4}, "size": "1 lb"}]}]}
    out = KrogerRetail._parse_prices(payload)
    assert out[0].unit == "1 lb"
```

Add to `backend/tests/test_sourcing.py` (self-contained stubs, matching the file's existing style):

```python
def test_po_line_carries_offer_unit():
    class _Wholesale:
        def get_wholesale_price(self, item): return None

    class _Retail:
        def get_retail_prices(self, item, location):
            return [SupplierPrice(supplier="Kroger", unit_price=1.0,
                                  description="Green Cabbage", unit="1 lb")]

    class _BadLLM:
        def complete(self, system, user): return "not json"

    resp = source_order([{"item": "cabbage", "qty": 3}],
                        _Wholesale(), _Retail(), _BadLLM(), "40.7,-74.0")
    assert resp.lines[0].unit == "1 lb"
```

Add to `frontend/__tests__/csv.test.ts` a unit-column expectation — extend one existing fixture line with `unit: "1 lb"` and assert the exported header is `item,qty,unit,supplier,unit_price,line_total,note` and the row contains `,1 lb,`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_price_kroger.py tests/test_sourcing.py -q`
Expected: FAIL — `unit` is not a `SupplierPrice`/`POLine` field.

- [ ] **Step 3: Implement backend**

`backend/wastewise/models.py`:

```python
class SupplierPrice(BaseModel):
    supplier: str
    unit_price: float
    description: str = ""
    unit: str = ""
```

```python
class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str
    live: bool
    unit: str = ""
```

`backend/wastewise/adapters/price_kroger.py` `_parse_prices` — capture the package size:

```python
            out.append(SupplierPrice(supplier="Kroger", unit_price=float(val),
                                     description=str(product.get("description") or ""),
                                     unit=str(items[0].get("size") or "")))
```

`backend/wastewise/agents/sourcing.py` `source_order` — copy the chosen offer's unit onto the line (final loop):

```python
        if offer is not None:
            supplier, unit_price, unit = offer.supplier, offer.unit_price, offer.unit
        elif benchmark is not None:
            supplier, unit_price, unit = "Market", benchmark, ""
        else:
            supplier, unit_price, unit = "No price data", 0.0, ""
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=note, live=live, unit=unit))
```

- [ ] **Step 4: Implement frontend**

`frontend/lib/types.ts` — add `unit?: string;` to `POLine`.

`frontend/lib/demo.ts` — add `unit: "1 lb"` to all three `DEMO_SOURCING.lines` entries.

`frontend/lib/csv.ts`:

```ts
export function poToCsv(lines: POLine[], total: number): string {
  const header = "item,qty,unit,supplier,unit_price,line_total,note";
  const rows = lines.map((l) =>
    [esc(l.item), l.qty, esc(l.unit ?? ""), esc(l.supplier), l.unit_price, l.line_total, esc(l.note)].join(","),
  );
  return [header, ...rows, `Total,,,,,${total},`].join("\n");
}
```

`frontend/components/po-table.tsx` — unit-price cell shows the package size:

```tsx
            <td className="ww-num px-4 py-3 text-right text-sm">
              ${l.unit_price.toFixed(2)}
              {l.unit ? <span className="text-muted-foreground"> / {l.unit}</span> : null}
            </td>
```

`frontend/components/price-table.tsx` — `PriceCell` takes and shows the unit:

```tsx
function PriceCell({ supplier, unitPrice, unit }: { supplier: string; unitPrice: number; unit?: string }) {
  const isFallback = supplier === "Market";
  if (unitPrice === 0) {
    return <span className="ww-num text-muted-foreground">&mdash;</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="ww-num text-sm">
        ${unitPrice.toFixed(2)}
        {unit ? <span className="text-muted-foreground"> / {unit}</span> : null}
      </span>
      {isFallback ? (
        <span className="text-[10px] italic text-muted-foreground">benchmark</span>
      ) : null}
    </div>
  );
}
```

and its call site: `<PriceCell supplier={l.supplier} unitPrice={l.unit_price} unit={l.unit} />`.

- [ ] **Step 5: Run all tests**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q` then `cd ../frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass. If any existing test constructs `POLine`/`SupplierPrice` and asserts full-dict equality, add `unit: ""` there.

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/adapters/price_kroger.py backend/wastewise/agents/sourcing.py backend/tests/test_price_kroger.py backend/tests/test_sourcing.py frontend/lib/types.ts frontend/lib/demo.ts frontend/lib/csv.ts frontend/components/po-table.tsx frontend/components/price-table.tsx frontend/__tests__/csv.test.ts
git commit -m "feat: surface package units on sourcing prices and PO lines"
```

---

### Task 7: Editable PO quantities

The Approve flow is stronger if the buyer can adjust quantities and watch totals recompute — real human-in-the-loop, not just a rubber stamp.

**Files:**
- Modify: `frontend/components/po-table.tsx`
- Modify: `frontend/app/order/page.tsx`
- Test: `frontend/__tests__/order.test.tsx`

**Interfaces:**
- Produces: `POTable({ lines, total, onQtyChange }: { lines: POLine[]; total: number; onQtyChange?: (index: number, qty: number) => void })` — input rendered only when the callback is provided, so the component stays display-only elsewhere.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/__tests__/order.test.tsx`:

```tsx
  it("recomputes line and grand totals when a quantity is edited", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    expect(screen.getByText(/\$140\.00/)).toBeInTheDocument(); // 100 × $1.40
    expect(screen.getByText(/\$548\.40/)).toBeInTheDocument(); // 140 + 165.2 + 243.2
  });

  it("un-approves when the order changes after approval", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    expect(screen.getByRole("button", { name: /^approve$/i })).not.toBeDisabled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run __tests__/order.test.tsx`
Expected: FAIL — no element with label "Quantity for cabbage".

- [ ] **Step 3: Implement**

`frontend/components/po-table.tsx` — new prop and editable qty cell:

```tsx
export function POTable({
  lines,
  total,
  onQtyChange,
}: {
  lines: POLine[];
  total: number;
  onQtyChange?: (index: number, qty: number) => void;
}) {
```

qty cell (replacing the static `{l.qty}` cell):

```tsx
            <td className="ww-num px-4 py-3 text-right text-sm">
              {onQtyChange ? (
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={l.qty}
                  aria-label={`Quantity for ${l.item}`}
                  onChange={(e) => onQtyChange(idx, Math.max(0, Number(e.target.value) || 0))}
                  className="ww-num w-20 border border-foreground/25 bg-card px-2 py-1 text-right text-sm focus:border-accent focus:outline-none"
                />
              ) : (
                l.qty
              )}
            </td>
```

`frontend/app/order/page.tsx` — add the handler and pass it (place above the `return`):

```tsx
  function round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  function updateQty(index: number, qty: number) {
    if (!sourcing) return;
    const lines = sourcing.lines.map((l, i) =>
      i === index ? { ...l, qty, line_total: round2(l.unit_price * qty) } : l,
    );
    const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
    set({ sourcing: { ...sourcing, lines, total } });
    setApproved(false);
  }
```

```tsx
          <POTable lines={sourcing.lines} total={sourcing.total} onQtyChange={updateQty} />
```

Note: `savings` intentionally stays as sourced — it compares the *sourced* order to the benchmark; recomputing it client-side would need per-line benchmarks the response doesn't carry. The CSV export picks up edited lines automatically because `download()` reads `sourcing.lines` from the store.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass (the Sourcing page's `PriceTable` reads the same store lines — edited qty showing there after back-navigation is correct behavior).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/po-table.tsx frontend/app/order/page.tsx frontend/__tests__/order.test.tsx
git commit -m "feat: editable PO quantities with live total recompute before approval"
```

---

### Task 8: Per-day forecast series (backend)

The chart in Task 9 needs day-level forecasts; the model already predicts per-day rows before summing. Expose them.

**Files:**
- Modify: `backend/wastewise/models.py` (`ForecastItem`, `AdjustedItem`)
- Modify: `backend/wastewise/forecasting/forecaster.py` (`forecast_items` loop)
- Modify: `backend/wastewise/agents/adjustment.py` (`_adjust_one` both return paths)
- Test: `backend/tests/test_forecaster.py`, `backend/tests/test_adjustment.py`

**Interfaces:**
- Produces: `ForecastItem.daily: list[float] = []` and `AdjustedItem.daily: list[float] = []` — the raw per-day model predictions (display-only; `forecast` remains the clipped sum, so `sum(daily)` may differ marginally when a day clips at 0).

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_forecaster.py`:

```python
def test_forecast_items_include_daily_series(sample_sales):
    items, _ = forecast_items(sample_sales, horizon_days=7)
    for it in items:
        assert len(it.daily) == 7
        assert all(d >= 0 for d in it.daily)
```

In `backend/tests/test_adjustment.py`, give the `_items()` fixture daily data and assert it survives adjustment:

```python
def _items():
    return [
        ForecastItem(item="stew", forecast=100, baseline=95, safety_buffer=15,
                    recommended_purchase_qty=115, daily=[14, 15, 14, 15, 14, 14, 14]),
        ForecastItem(item="salad greens", forecast=80, baseline=75,
                    safety_buffer=10, recommended_purchase_qty=90,
                    daily=[11, 12, 11, 12, 11, 11, 12]),
    ]


def test_adjustment_preserves_daily_series():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _BadJsonLLM())
    assert out[0].daily == [14, 15, 14, 15, 14, 14, 14]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_forecaster.py tests/test_adjustment.py -q`
Expected: FAIL — `daily` not a `ForecastItem` field.

- [ ] **Step 3: Implement**

`backend/wastewise/models.py`:

```python
class ForecastItem(BaseModel):
    item: str
    forecast: float
    baseline: float
    safety_buffer: float
    recommended_purchase_qty: float
    daily: list[float] = []


class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str
    live: bool
    daily: list[float] = []
```

`backend/wastewise/forecasting/forecaster.py` — inside the `forecast_items` per-item loop:

```python
        preds = model.predict(future[FEATURES])
        daily = [round(float(max(p, 0.0)), 2) for p in preds]
        pred = float(np.clip(preds.sum(), 0, None))
        base = baseline_forecast(records, item, horizon_days)
        buffer = safety_frac * pred
        items.append(ForecastItem(item=item, forecast=round(pred, 2),
                                  baseline=round(base, 2),
                                  safety_buffer=round(buffer, 2),
                                  recommended_purchase_qty=round(pred + buffer, 2),
                                  daily=daily))
```

`backend/wastewise/agents/adjustment.py` `_adjust_one` — carry `daily` on both paths:

```python
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=adjusted_qty, reason=reason, live=True,
                            daily=item.daily)
    except Exception:
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=item.recommended_purchase_qty,
                            reason=FALLBACK_REASON, live=False, daily=item.daily)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: all pass (`daily` defaults keep every existing fixture valid).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/forecasting/forecaster.py backend/wastewise/agents/adjustment.py backend/tests/test_forecaster.py backend/tests/test_adjustment.py
git commit -m "feat: expose per-day forecast series on forecast and adjusted items"
```

---

### Task 9: History + forecast chart (frontend)

The classic visual that sells a forecasting product: the uploaded sales history flowing into a dashed forecast continuation, per item. History is parsed client-side from the CSV the user already selected; forecast days come from Task 8's `daily`.

**Files:**
- Modify: `frontend/lib/types.ts` (add `HistoryPoint`, `daily` on `ForecastAdjustedItem`)
- Modify: `frontend/lib/csv.ts` (add `parseSalesHistory`)
- Modify: `frontend/lib/store.tsx` (add `history` to wizard state)
- Modify: `frontend/lib/demo.ts` (add `DEMO_HISTORY`, `daily` on `DEMO_FORECAST` items)
- Modify: `frontend/app/setup/page.tsx` (parse on upload, store history)
- Create: `frontend/components/history-chart.tsx`
- Modify: `frontend/app/forecast/page.tsx` (render the chart)
- Test: `frontend/__tests__/csv.test.ts`, `frontend/__tests__/forecast.test.tsx`

**Interfaces:**
- Consumes: `AdjustedItem.daily` from Task 8.
- Produces: `HistoryPoint { date: string; item: string; quantity: number }` in `types.ts`; `parseSalesHistory(text: string, maxDays?: number): HistoryPoint[]` in `csv.ts`; `WizardState.history: HistoryPoint[] | null`; `<HistoryChart history items />`.

- [ ] **Step 1: Write the failing parser tests**

Add to `frontend/__tests__/csv.test.ts`:

```ts
import { parseSalesHistory } from "@/lib/csv";

describe("parseSalesHistory", () => {
  it("parses date,item,quantity rows and skips malformed lines", () => {
    const text = "date,item,quantity\n2026-06-01,cabbage,20\n2026-06-01,pork,15\nbad,row\n2026-06-02,cabbage,22";
    const out = parseSalesHistory(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ date: "2026-06-01", item: "cabbage", quantity: 20 });
  });

  it("tolerates a price column and header case differences", () => {
    const text = "Date,Item,Quantity,Price\n2026-06-01,cabbage,20,1.5";
    expect(parseSalesHistory(text)).toEqual([{ date: "2026-06-01", item: "cabbage", quantity: 20 }]);
  });

  it("keeps only the most recent maxDays dates", () => {
    const rows = Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")},cabbage,${i}`);
    const out = parseSalesHistory(["date,item,quantity", ...rows].join("\n"), 3);
    expect(new Set(out.map((p) => p.date)).size).toBe(3);
    expect(out[0].date).toBe("2026-06-08");
  });

  it("returns [] when required headers are missing", () => {
    expect(parseSalesHistory("a,b,c\n1,2,3")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run __tests__/csv.test.ts`
Expected: FAIL — `parseSalesHistory` not exported.

- [ ] **Step 3: Implement the parser and state plumbing**

`frontend/lib/types.ts` — add:

```ts
export interface HistoryPoint {
  date: string;
  item: string;
  quantity: number;
}
```

and extend `ForecastAdjustedItem` with `daily?: number[];`.

`frontend/lib/csv.ts` — add (imports become `import type { POLine, HistoryPoint } from "./types";`):

```ts
// Client-side mirror of the backend's ingest schema (date,item,quantity[,price]).
// Keeps only the most recent maxDays dates so sessionStorage stays small.
export function parseSalesHistory(text: string, maxDays = 60): HistoryPoint[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const di = header.indexOf("date");
  const ii = header.indexOf("item");
  const qi = header.indexOf("quantity");
  if (di < 0 || ii < 0 || qi < 0) return [];
  const points: HistoryPoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[di]?.trim();
    const item = cols[ii]?.trim();
    const quantity = Number(cols[qi]);
    if (!date || !item || !Number.isFinite(quantity)) continue;
    points.push({ date, item, quantity });
  }
  const dates = [...new Set(points.map((p) => p.date))].sort();
  const keep = new Set(dates.slice(-maxDays));
  return points.filter((p) => keep.has(p.date));
}
```

`frontend/lib/store.tsx` — add to the interface, defaults, and import:

```tsx
import type { DatasetSummary, ForecastResponse, SourcingResponse, RationaleResponse, Horizon, HistoryPoint } from "./types";
```
```tsx
interface WizardState {
  location: string;
  horizon: Horizon;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
  rationale: RationaleResponse | null;
  history: HistoryPoint[] | null;
}
```
```tsx
const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
  rationale: null,
  history: null,
};
```

`frontend/lib/demo.ts` — add `daily` to each `DEMO_FORECAST` item and a deterministic history:

```ts
    { item: "cabbage", forecast: 168.0, adjusted_qty: 150.0, live: true,
      daily: [22, 23, 22, 24, 25, 26, 26],
      reason: "Rain forecast lowers dine-in demand for fresh-cut sides like cabbage slaw." },
    { item: "pork", forecast: 126.0, adjusted_qty: 118.0, live: true,
      daily: [17, 18, 17, 18, 18, 19, 19],
      reason: "Rain dampens dine-in traffic, but pork's use in stews softens the drop." },
    { item: "chicken", forecast: 210.0, adjusted_qty: 196.0, live: true,
      daily: [28, 29, 29, 30, 31, 31, 32],
      reason: "Rain lowers dine-in demand most for quick-grill items like chicken." },
```

```ts
import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse, HistoryPoint } from "./types";

export const DEMO_HISTORY: HistoryPoint[] = (() => {
  const out: HistoryPoint[] = [];
  const base: Record<string, number> = { cabbage: 22, chicken: 30, pork: 18 };
  const start = new Date("2026-06-02T00:00:00Z");
  for (let d = 0; d < 28; d++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + d);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    for (const item of Object.keys(base)) {
      const wave = Math.sin((d + item.length) * 1.1) * 3;
      out.push({
        date: day.toISOString().slice(0, 10),
        item,
        quantity: Math.round((base[item] + (weekend ? 8 : 0) + wave) * 10) / 10,
      });
    }
  }
  return out;
})();
```

`frontend/app/setup/page.tsx` — thread history through `advance` and both entry points:

```tsx
import { parseSalesHistory } from "@/lib/csv";
import { DEMO_HISTORY } from "@/lib/demo";
import type { HistoryPoint } from "@/lib/types";
```
```tsx
  function advance(res: UploadResponse, history: HistoryPoint[] | null) {
    set({ datasetId: res.dataset_id, summary: res.summary, forecast: null, sourcing: null, rationale: null, history });
    router.push("/forecast");
  }

  async function onUpload() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      advance(await uploadCsv(file), parseSalesHistory(text));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onDemo() {
    setDemoMode(true);
    setError(null);
    setLoading(true);
    try {
      advance(await uploadCsv(new File([""], "demo.csv", { type: "text/csv" })), DEMO_HISTORY);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }
```

and add `history: null` to the mount-time reset `set({...})` call.

- [ ] **Step 4: Run parser tests**

Run: `cd frontend && npx vitest run __tests__/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing chart test**

Add to `frontend/__tests__/forecast.test.tsx`:

```tsx
  it("renders the history-vs-forecast chart when history is present", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, {
      initial: { datasetId: "demo", history: DEMO_HISTORY },
    });
    expect(await screen.findByText(/sales history & forecast/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/chart item/i)).toBeInTheDocument();
  });
```

(add `DEMO_HISTORY` to the existing `@/lib/demo` import in that file.)

Run: `cd frontend && npx vitest run __tests__/forecast.test.tsx` — expected FAIL.

- [ ] **Step 6: Implement the chart**

Create `frontend/components/history-chart.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem, HistoryPoint } from "@/lib/types";

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)", fill: "#5a5148" };

export function HistoryChart({
  history,
  items,
}: {
  history: HistoryPoint[];
  items: ForecastAdjustedItem[];
}) {
  const [selected, setSelected] = useState(items[0]?.item ?? "");

  const data = useMemo(() => {
    const hist = history
      .filter((p) => p.item === selected)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (hist.length === 0) return [];
    const rows: { date: string; actual: number | null; forecast: number | null }[] =
      hist.map((p) => ({ date: p.date, actual: p.quantity, forecast: null }));
    const daily = items.find((i) => i.item === selected)?.daily ?? [];
    // Anchor the forecast segment to the last actual point so the lines connect.
    rows[rows.length - 1].forecast = hist[hist.length - 1].quantity;
    const last = new Date(hist[hist.length - 1].date + "T00:00:00Z");
    daily.forEach((q, i) => {
      const d = new Date(last);
      d.setUTCDate(last.getUTCDate() + i + 1);
      rows.push({ date: d.toISOString().slice(0, 10), actual: null, forecast: q });
    });
    return rows;
  }, [history, items, selected]);

  if (data.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2">
        <p className="ww-label">Fig. 2 — Sales history &amp; forecast</p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Chart item"
          className="ww-num h-7 border border-foreground/25 bg-card px-2 text-xs capitalize focus:border-accent focus:outline-none"
        >
          {items.map((i) => (
            <option key={i.item} value={i.item}>
              {i.item}
            </option>
          ))}
        </select>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="date" tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} minTickGap={24} />
            <YAxis tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} width={40} />
            <Tooltip
              formatter={(v) => Number(v).toFixed(1)}
              contentStyle={{
                background: "#f7f2e8",
                border: "1px solid #1a1a1a",
                borderRadius: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              labelStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
            />
            <Line type="monotone" dataKey="actual" stroke="#7a6a4a" strokeWidth={1.5} dot={false} name="Actual sales" />
            <Line type="monotone" dataKey="forecast" stroke="#1a1a1a" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Forecast" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

`frontend/app/forecast/page.tsx` — pull `history` from the wizard and render below the Fig. 1 card:

```tsx
  const { datasetId, horizon, location, forecast, history, hydrated, set } = useWizard();
```
```tsx
import { HistoryChart } from "@/components/history-chart";
```
```tsx
          {history && history.length > 0 ? (
            <div className="border border-foreground/20 bg-card">
              <HistoryChart history={history} items={forecast.items} />
            </div>
          ) : null}
```

- [ ] **Step 7: Run all frontend checks**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: all pass. If `__tests__/store.test.tsx` asserts the exact `DEFAULTS` shape, add `history: null` to its expectation.

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/csv.ts frontend/lib/store.tsx frontend/lib/demo.ts frontend/app/setup/page.tsx frontend/components/history-chart.tsx frontend/app/forecast/page.tsx frontend/__tests__/csv.test.ts frontend/__tests__/forecast.test.tsx
git commit -m "feat: history-vs-forecast line chart with per-item selection"
```

---

## Final verification

- [ ] `cd backend && ./.venv/Scripts/python.exe -m pytest -q` — full suite green.
- [ ] `cd frontend && npx vitest run && npx tsc --noEmit` — full suite + types green.
- [ ] Manual smoke: `npm run dev` with `NEXT_PUBLIC_API_URL` unset → demo banner visible on every screen; walk Setup → Forecast (two stat tiles + Fig. 2 chart with item selector) → Sourcing (units after prices) → Order (edit a qty, totals recompute, Approve resets).
- [ ] Manual smoke with the backend running (`uvicorn wastewise.api:app --reload` + `NEXT_PUBLIC_API_URL=http://localhost:8000`): upload `backend/wastewise/data/demo_sales_forecast_only.csv`, confirm the waste tile shows a units figure and Fig. 2 draws real history.
