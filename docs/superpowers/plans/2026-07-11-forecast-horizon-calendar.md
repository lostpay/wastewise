# Forecast Horizon Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-option "Next day / Next week" horizon dropdown with a calendar range picker that lets the user choose any forecast length from 1 to 14 days.

**Architecture:** The backend forecast pipeline is already horizon-length-agnostic — it takes a day count and drives weather fetch, holiday span, and the per-day forecast series off it. We change the API contract from a `"day" | "week"` literal to an integer `horizon_days` (1–14). On the frontend, a new self-contained `HorizonCalendar` component (month grid, no new dependency) replaces the `<select>` on the setup page. The calendar's start is locked to the day after the dataset's last date — derived client-side by parsing the dropped CSV (or the demo dataset's known end date) — and the user clicks an end date within a 14-day window.

**Tech Stack:** FastAPI + Pydantic (backend), pytest; Next.js 16 / React 19.2 / TypeScript / Tailwind v4 (frontend), Vitest + Testing Library, `lucide-react` icons.

## Global Constraints

- **No new frontend dependencies.** Build the calendar with plain `Date` math and existing `lucide-react` icons.
- **Horizon range is 1–14 days**, enforced on both the backend (Pydantic validation) and the frontend (calendar caps selectable days).
- **Frontend Next.js is modified from stock.** Per `frontend/AGENTS.md`, before writing frontend code read the relevant guide in `frontend/node_modules/next/dist/docs/`. Heed deprecation notices.
- **All dates are handled in UTC** to avoid timezone drift in date math (the codebase already uses UTC ISO strings like `"2026-06-29"`).
- **Commit messages:** short, imperative, no `Co-Authored-By` trailer (matches this repo's existing history).
- The forecast start is always `dataset end_date + 1 day`; the model cannot start a forecast at an arbitrary future date.

---

### Task 1: Backend — integer `horizon_days` contract

Replace the `Literal["day","week"]` horizon with a validated integer day count and thread it through the pipeline.

**Files:**
- Modify: `backend/wastewise/api.py` (imports; `ForecastRequest` at :78-80; `/forecast` handler at :124-131)
- Modify: `backend/wastewise/pipeline.py:1-30` (`run_forecast` signature; remove `_HORIZON`)
- Test: `backend/tests/test_pipeline.py:32`, `backend/tests/test_api.py:52,66`, `backend/tests/test_integration.py:48`

**Interfaces:**
- Produces: `ForecastRequest.horizon_days: int` (default `7`, `ge=1`, `le=14`); JSON field `horizon_days`.
- Produces: `run_forecast(records: list[SalesRecord], horizon_days: int, location: str, weather_src, holiday_src, llm) -> ForecastResponse`.

- [ ] **Step 1: Update the pipeline tests to the new signature**

In `backend/tests/test_pipeline.py`, change the call on line 32 from:
```python
    resp = run_forecast(sample_sales, "week", "40.7,-74.0", weather, holidays, _LLM())
```
to:
```python
    resp = run_forecast(sample_sales, 7, "40.7,-74.0", weather, holidays, _LLM())
```

In `backend/tests/test_api.py`, change both `/forecast` request bodies (lines 52-53 and 66-67) from `"horizon": "week"` to `"horizon_days": 7`. After the edit they read:
```python
    f = client.post("/forecast", json={"dataset_id": ds_id, "horizon_days": 7,
                    "location": "40.7,-74.0"})
```
```python
    r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": 7,
                    "location": "not-a-latlon"})
```

In `backend/tests/test_integration.py`, change line 48 from `"horizon": "week"` to `"horizon_days": 7`.

- [ ] **Step 2: Add a validation test for the new bounds**

Append to `backend/tests/test_api.py` (uses the existing `_client` helper and `api` import already in the file):
```python
def test_forecast_rejects_out_of_range_horizon(tmp_path):
    client = _client(tmp_path)
    for bad in (0, 15):
        r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": bad,
                        "location": "40.7,-74.0"})
        assert r.status_code == 422
    api.app.dependency_overrides.clear()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_pipeline.py tests/test_api.py tests/test_integration.py -q`
Expected: FAIL — `run_forecast` still takes a string horizon and `ForecastRequest` still rejects `horizon_days` / accepts only `"day"`/`"week"`.

- [ ] **Step 4: Update `pipeline.run_forecast`**

In `backend/wastewise/pipeline.py`, delete line 8 (`_HORIZON = {"day": 1, "week": 7}`) and change the function signature + first body line (lines 11-13) from:
```python
def run_forecast(records: list[SalesRecord], horizon: str, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
    horizon_days = _HORIZON[horizon]
```
to:
```python
def run_forecast(records: list[SalesRecord], horizon_days: int, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
```
Leave the rest of the function unchanged — it already uses `horizon_days` throughout.

- [ ] **Step 5: Update `ForecastRequest` and the `/forecast` handler**

In `backend/wastewise/api.py`:

Remove the now-unused `Literal` import. Change line 5 from:
```python
from typing import Literal
```
Delete that line entirely (no other use of `Literal` remains in the file).

Add `Field` to the pydantic import on line 8:
```python
from pydantic import BaseModel, Field, field_validator
```

Change `ForecastRequest` (lines 78-80) from:
```python
class ForecastRequest(_LocatedRequest):
    dataset_id: str
    horizon: Literal["day", "week"] = "week"
```
to:
```python
class ForecastRequest(_LocatedRequest):
    dataset_id: str
    # Number of consecutive days to forecast, starting the day after the
    # dataset's last date. Capped at 14: beyond ~16 days the weather source
    # (Open-Meteo) stops returning real forecasts and adjustments go neutral.
    horizon_days: int = Field(default=7, ge=1, le=14)
```

Change the `/forecast` handler call (lines 130-131) from:
```python
    return run_forecast(records, req.horizon, req.location,
                        deps["weather"], deps["holidays"], deps["llm"])
```
to:
```python
    return run_forecast(records, req.horizon_days, req.location,
                        deps["weather"], deps["holidays"], deps["llm"])
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_pipeline.py tests/test_api.py tests/test_integration.py -q`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite to catch any other horizon references**

Run: `cd backend && python -m pytest -q`
Expected: PASS (no other test references `"day"`/`"week"` horizons — verified during planning, but confirm).

- [ ] **Step 8: Commit**

```bash
git add backend/wastewise/api.py backend/wastewise/pipeline.py backend/tests/test_pipeline.py backend/tests/test_api.py backend/tests/test_integration.py
git commit -m "feat: forecast horizon as an integer day count (1-14) instead of day/week"
```

---

### Task 2: `HorizonCalendar` component

A self-contained month-grid calendar. The start day is locked (the first forecast day); the user clicks an end date within `[start, start + maxDays - 1]`; everything outside that window is disabled. Emits the selected length in days.

**Files:**
- Create: `frontend/components/ui/horizon-calendar.tsx`
- Test: `frontend/__tests__/horizon-calendar.test.tsx`

**Interfaces:**
- Produces:
```ts
interface HorizonCalendarProps {
  start: string;              // ISO "YYYY-MM-DD": first forecast day (locked anchor)
  days: number;              // currently selected length (>= 1)
  maxDays?: number;          // default 14
  onChange: (days: number) => void;
}
export function HorizonCalendar(props: HorizonCalendarProps): JSX.Element
```
- Consumes: `lucide-react` (`ChevronLeft`, `ChevronRight`), `@/lib/utils` `cn` (className merge helper already used across `components/ui`).

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/horizon-calendar.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HorizonCalendar } from "@/components/ui/horizon-calendar";

describe("HorizonCalendar", () => {
  it("shows the selected length in the caption", () => {
    render(<HorizonCalendar start="2026-06-01" days={7} onChange={() => {}} />);
    expect(screen.getByText(/7 days/)).toBeInTheDocument();
  });

  it("reports the length in days when an end date in range is clicked", async () => {
    const onChange = vi.fn();
    // start 2026-06-01, maxDays 14 -> selectable June 1..June 14
    render(<HorizonCalendar start="2026-06-01" days={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "10" })); // June 10
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("disables days beyond the maxDays window", async () => {
    const onChange = vi.fn();
    render(<HorizonCalendar start="2026-06-01" days={1} maxDays={14} onChange={onChange} />);
    const beyond = screen.getByRole("button", { name: "20" }); // June 20 > June 14
    expect(beyond).toBeDisabled();
    await userEvent.click(beyond);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a single day as '1 day' (singular)", () => {
    render(<HorizonCalendar start="2026-06-01" days={1} onChange={() => {}} />);
    expect(screen.getByText(/1 day\b/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run __tests__/horizon-calendar.test.tsx`
Expected: FAIL — module `@/components/ui/horizon-calendar` does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/components/ui/horizon-calendar.tsx`:
```tsx
"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HorizonCalendarProps {
  start: string; // ISO "YYYY-MM-DD": first forecast day (locked anchor)
  days: number; // currently selected length (>= 1)
  maxDays?: number; // default 14
  onChange: (days: number) => void;
}

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}
function fmt(d: Date): string {
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

export function HorizonCalendar({ start, days, maxDays = 14, onChange }: HorizonCalendarProps) {
  const startDate = parseISO(start);
  const lastSelectable = addDays(startDate, maxDays - 1);
  const endDate = addDays(startDate, days - 1);
  // The view month defaults to the anchor's month; the [start, start+maxDays-1]
  // window can spill into the next month, so allow navigation between them.
  const [view, setView] = useState({ y: startDate.getUTCFullYear(), m: startDate.getUTCMonth() });

  const firstOfMonth = new Date(Date.UTC(view.y, view.m, 1));
  const leadBlanks = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(view.y, view.m, d)));

  const inWindow = (d: Date) => d.getTime() >= startDate.getTime() && d.getTime() <= lastSelectable.getTime();
  const inRange = (d: Date) => d.getTime() >= startDate.getTime() && d.getTime() <= endDate.getTime();

  return (
    <div className="border border-foreground/25 bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="ww-num text-sm font-medium">{MONTHS[view.m]} {view.y}</span>
        <button
          type="button"
          aria-label="Next month"
          className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="ww-label pb-1 text-center text-[10px] text-muted-foreground">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const selectable = inWindow(d);
          const ranged = inRange(d);
          const isStart = d.getTime() === startDate.getTime();
          const isEnd = d.getTime() === endDate.getTime();
          return (
            <button
              key={i}
              type="button"
              disabled={!selectable}
              onClick={() => onChange(diffDays(startDate, d) + 1)}
              className={cn(
                "ww-num h-8 text-sm transition-colors",
                !selectable && "text-muted-foreground/40",
                selectable && !ranged && "hover:bg-foreground/10",
                ranged && "bg-accent/20",
                (isStart || isEnd) && "bg-accent text-background font-semibold",
              )}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>

      <p className="ww-num mt-3 border-t border-dashed border-foreground/20 pt-2 text-center text-xs text-muted-foreground">
        {fmt(startDate)} &rarr; {fmt(endDate)} &middot;{" "}
        <span className="font-medium text-foreground">{days} day{days === 1 ? "" : "s"}</span>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run __tests__/horizon-calendar.test.tsx`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/horizon-calendar.tsx frontend/__tests__/horizon-calendar.test.tsx
git commit -m "feat: add HorizonCalendar month-grid range picker component"
```

---

### Task 3: Wire the calendar through store, API client, setup, and forecast pages

Rename the wizard's `horizon` string to `horizonDays: number`, post `horizon_days` from the API client, render `HorizonCalendar` on the setup page (anchored to the dataset's last date, derived client-side), and update the forecast page's run call and copy. These files share the `Horizon` type and the wizard field, so they change together to keep TypeScript compiling.

**Files:**
- Modify: `frontend/lib/types.ts:1` (remove `Horizon` type)
- Modify: `frontend/lib/store.tsx:4,10,22` (`horizon` → `horizonDays`)
- Modify: `frontend/lib/api.ts:1,67-69` (`runForecast` param + body)
- Modify: `frontend/app/setup/page.tsx` (imports; replace §1.4 `<select>`; add file-parse effect)
- Modify: `frontend/app/forecast/page.tsx:18,33,37,58` (`horizon` → `horizonDays`; copy)
- Test: `frontend/__tests__/store.test.tsx:14,26,29`, `frontend/__tests__/api.test.ts:25,31,37,51` (+ new body assertion)

**Interfaces:**
- Consumes: `HorizonCalendar` from Task 2; `parseSalesHistory` (`@/lib/csv`); `DEMO_UPLOAD` (`@/lib/demo`, `.summary.end_date === "2026-06-29"`).
- Produces: `WizardState.horizonDays: number` (default `7`); `runForecast(datasetId: string, horizonDays: number, location: string): Promise<ForecastResponse>` posting `{ dataset_id, horizon_days, location }`.

- [ ] **Step 1: Update the store and api-client tests first**

In `frontend/__tests__/store.test.tsx`:
- Line 14: change `expect(result.current.horizon).toBe("week");` to `expect(result.current.horizonDays).toBe(7);`
- Line 26: change the seeded state `{ datasetId: "seed", horizon: "day" }` to `{ datasetId: "seed", horizonDays: 3 }`
- Line 29: change `expect(result.current.horizon).toBe("day");` to `expect(result.current.horizonDays).toBe(3);`

In `frontend/__tests__/api.test.ts`, change all four `runForecast("ds1", "week", "40.7,-74.0")` calls (lines 25, 31, 37, 51) to `runForecast("ds1", 7, "40.7,-74.0")`. Then add this test inside the `describe` block (before the closing `});`):
```ts
  it("sends horizon_days in the forecast request body", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ items: [], baseline_delta: 0 }));
    vi.stubGlobal("fetch", spy);
    await runForecast("ds1", 10, "40.7,-74.0");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.horizon_days).toBe(10);
    expect(body.dataset_id).toBe("ds1");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run __tests__/store.test.tsx __tests__/api.test.ts`
Expected: FAIL — `horizonDays` is undefined on the store and `runForecast` still takes/sends a string horizon.

- [ ] **Step 3: Remove the `Horizon` type**

In `frontend/lib/types.ts`, delete line 1:
```ts
export type Horizon = "day" | "week";
```

- [ ] **Step 4: Update the store**

In `frontend/lib/store.tsx`:
- Line 4: remove `Horizon` from the type import (leave the other imports intact):
```tsx
import type { DatasetSummary, ForecastResponse, SourcingResponse, RationaleResponse, Currency, HistoryPoint } from "./types";
```
- Line 10: change `horizon: Horizon;` to `horizonDays: number;`
- Line 22: change `horizon: "week",` to `horizonDays: 7,`

- [ ] **Step 5: Update the API client**

In `frontend/lib/api.ts`:
- Line 1: remove `Horizon` from the type import.
- Replace `runForecast` (lines 67-69):
```ts
export function runForecast(datasetId: string, horizonDays: number, location: string): Promise<ForecastResponse> {
  return call("/forecast", jsonInit({ dataset_id: datasetId, horizon_days: horizonDays, location }), DEMO_FORECAST);
}
```

- [ ] **Step 6: Update the setup page**

In `frontend/app/setup/page.tsx`:

Add `DEMO_UPLOAD` to the **existing** `@/lib/demo` import on line 8 (do not add a second import from the same module — the `no-duplicate-imports` lint rule fails the build in Step 9):
```tsx
import { setDemoMode, clearDemoServed, DEMO_HISTORY, DEMO_UPLOAD } from "@/lib/demo";
```
Replace the type import on line 10 (drop `Horizon`) and add the two other new imports:
```tsx
import type { Currency, UploadResponse, HistoryPoint } from "@/lib/types";
import { parseSalesHistory } from "@/lib/csv";
import { HorizonCalendar } from "@/components/ui/horizon-calendar";
```

Change the store destructure on line 23 from `horizon` to `horizonDays`:
```tsx
  const { location, horizonDays, currency, datasetId, hydrated, set } = useWizard();
```

Add a `lastDate` state next to the others (after line 27):
```tsx
  const [lastDate, setLastDate] = useState<string>(DEMO_UPLOAD.summary.end_date);
```

Add an effect that derives the dataset's last date from the dropped CSV (place after the existing reset effect, ~line 42):
```tsx
  // The forecast starts the day after the data ends, so the calendar anchor is
  // the CSV's last date. Parse the chosen file client-side to find it; with no
  // file (incl. the demo path) fall back to the demo dataset's known end date.
  useEffect(() => {
    if (!file) {
      setLastDate(DEMO_UPLOAD.summary.end_date);
      return;
    }
    let cancelled = false;
    file.text()
      .then((text) => {
        if (cancelled) return;
        const dates = parseSalesHistory(text).map((p) => p.date).sort();
        setLastDate(dates.length ? dates[dates.length - 1] : DEMO_UPLOAD.summary.end_date);
      })
      .catch(() => {
        if (!cancelled) setLastDate(DEMO_UPLOAD.summary.end_date);
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
```

Compute the anchored start just before the `return` (after line 76), reusing the component's date helpers inline:
```tsx
  const [ly, lm, ld] = lastDate.split("-").map(Number);
  const startISO = new Date(Date.UTC(ly, lm - 1, ld + 1)).toISOString().slice(0, 10);
```

Replace the entire §1.4 Horizon block (lines 126-139, the `<div className="space-y-2">` containing the `horizon` `<Label>` and `<select>`) with:
```tsx
      <div className="space-y-2">
        <p className="ww-label">1.4 &mdash; Forecast horizon</p>
        <HorizonCalendar
          start={startISO}
          days={horizonDays}
          onChange={(d) => set({ horizonDays: d })}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Forecasts start the day after your data ends. Pick an end date up to 14
          days out &mdash; beyond that, weather forecasts aren&rsquo;t available.
        </p>
      </div>
```

- [ ] **Step 7: Update the forecast page**

In `frontend/app/forecast/page.tsx`:
- Line 18: change the destructure to pull `horizonDays` and `summary`:
```tsx
  const { datasetId, horizonDays, location, forecast, history, summary, hydrated, set } = useWizard();
```
- Line 33: change `runForecast(datasetId, horizon, location)` to `runForecast(datasetId, horizonDays, location)`
- Line 37: in the dependency array, change `horizon` to `horizonDays`.
- Replace the description sentence (lines 57-61). Add a small helper above the `return` (after line 40) and use it:
```tsx
  const rangeLabel = (() => {
    if (!summary) return `next ${horizonDays} day${horizonDays === 1 ? "" : "s"}`;
    const [y, m, d] = summary.end_date.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d + 1));
    const end = new Date(Date.UTC(y, m - 1, d + horizonDays));
    const f = (x: Date) => x.toISOString().slice(0, 10);
    return `next ${horizonDays} day${horizonDays === 1 ? "" : "s"} (${f(start)} – ${f(end)})`;
  })();
```
Then change line 58's text from `Per-item demand for the next {horizon}.` to `Per-item demand for the {rangeLabel}.`

- [ ] **Step 8: Run the frontend tests to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: PASS (store, api, horizon-calendar, and all pre-existing suites).

- [ ] **Step 9: Typecheck and build to confirm no stale `horizon`/`Horizon` references remain**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors. (If `tsc` flags a leftover `horizon` reference anywhere, fix it — the rename must be complete.)

- [ ] **Step 10: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/store.tsx frontend/lib/api.ts frontend/app/setup/page.tsx frontend/app/forecast/page.tsx frontend/__tests__/store.test.tsx frontend/__tests__/api.test.ts
git commit -m "feat: pick forecast horizon with a calendar range instead of day/week"
```

---

## Verification (end-to-end)

After all tasks:

1. **Backend:** `cd backend && python -m pytest -q` → all pass.
2. **Frontend unit:** `cd frontend && npx vitest run` → all pass; `npx tsc --noEmit` clean.
3. **Manual smoke (real flow):**
   - Start backend (`cd backend && uvicorn wastewise.api:app --reload`) and frontend (`cd frontend && npm run dev`).
   - On **Setup**, drop a sales CSV. Confirm §1.4 shows a calendar whose highlighted start = the day after the CSV's last date, and that only a 14-day window is clickable.
   - Click an end date ~10 days out; the caption reads `… · 10 days`.
   - Upload & continue. On **Forecast**, confirm the copy reads "next 10 days (start – end)" and the per-item table/chart reflect a 10-day horizon.
   - Repeat with **Use demo dataset**: calendar anchors to `2026-06-30` (day after demo `end_date` `2026-06-29`). Note the forecast output is the static demo fixture regardless of range (pre-existing demo behavior).
4. **API contract check:** `curl -X POST localhost:8000/forecast -H 'Content-Type: application/json' -d '{"dataset_id":"<id>","horizon_days":15,"location":"40.7,-74.0"}'` → `422`; `horizon_days: 10` → `200` with a 10-element `daily` series per item.
