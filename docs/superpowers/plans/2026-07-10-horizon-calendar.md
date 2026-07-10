# Horizon Calendar Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Setup page's two-option day/week `<select>` with a calendar date picker (plus quick-pick shortcuts) that lets the user choose any forecast horizon from 1 to 30 days ahead.

**Architecture:** The forecast start stays implicit ("day after the dataset's last row") — only the horizon *length* becomes user-selectable. The backend already computes everything from a generic `horizon_days: int`; the only hardcoded translation is `pipeline.py`'s `_HORIZON = {"day": 1, "week": 7}` dict and the API's `Literal["day", "week"]` field, both of which are deleted, not replaced. On the frontend, `Horizon` becomes a plain `number` (days-from-today) threaded through the same wizard-state/sessionStorage mechanism that already exists; a new `HorizonPicker` component (quick-pick buttons + a vendored shadcn `Calendar` grid) replaces the `<select>`.

**Tech Stack:** FastAPI + Pydantic (backend validation), Next.js 16 / React 19 + Vitest + Testing Library (frontend), `react-day-picker` + `date-fns` via the shadcn `base-nova` registry (new calendar primitive).

## Global Constraints

- Horizon range: 1–30 days inclusive. 30-day cap because `lag7`/`roll7` features degrade past that point (see spec §"Scope decisions"). Enforced with Pydantic `Field(ge=1, le=30)` on the backend; enforced by disabling out-of-range calendar dates on the frontend (no client-side error UI needed — invalid values are structurally unreachable).
- The calendar is an **end-date picker only**: it selects how many days ahead to forecast, anchored to "today" for display purposes. It does NOT let the user pick an arbitrary start date. Do not build range-selection (`mode="range"`) — always `mode="single"`.
- Quick-pick shortcuts: Tomorrow (1 day), 1 week (7 days), 2 weeks (14 days).
- `components.json` pins this project to shadcn's `"base-nova"` style — the calendar must come from that registry (`npx shadcn add calendar`), not react-day-picker installed ad hoc, so it matches the visual language of the rest of `components/ui/`.
- Backend tests run via `pytest -q` from `backend/`. Frontend tests run via `npm test` from `frontend/` (= `vitest run`).
- Commits: plain Conventional Commits, **no AI-attribution trailer** (no `Co-Authored-By` line) — this repo's established convention. Create a new commit per task; do not amend.
- Spec: `docs/specs/2026-07-10-horizon-calendar-design.md`. Read it if any task instruction here seems ambiguous — it has the full rationale.

---

### Task 1: Backend — `horizon_days` int replaces the day/week enum

**Files:**
- Modify: `backend/wastewise/api.py` (`ForecastRequest`, `forecast()` handler, `Field` import)
- Modify: `backend/wastewise/pipeline.py` (`run_forecast`, drop `_HORIZON`)
- Modify: `backend/tests/test_api.py` (existing horizon call sites + new validation tests)
- Modify: `backend/tests/test_pipeline.py` (existing horizon call site)

**Interfaces:**
- Produces: `run_forecast(records: list[SalesRecord], horizon_days: int, location: str, weather_src, holiday_src, llm) -> ForecastResponse` — same positional slot as the old `horizon: str` param, now an `int`. Callers: `api.py::forecast()`, and Task 2/5's frontend `POST /forecast` body (`horizon_days` key).

- [ ] **Step 1: Update `test_api.py`'s existing forecast tests to the new contract**

In `backend/tests/test_api.py`, change both existing `"horizon": "week"` occurrences to `"horizon_days": 7`:

```python
    f = client.post("/forecast", json={"dataset_id": ds_id, "horizon_days": 7,
                    "location": "40.7,-74.0"})
```

```python
def test_forecast_rejects_malformed_location(tmp_path):
    client = _client(tmp_path)
    r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": 7,
                    "location": "not-a-latlon"})
    assert r.status_code == 422
    api.app.dependency_overrides.clear()
```

Then append two new test functions at the end of the file:

```python
def test_forecast_rejects_horizon_days_out_of_range(tmp_path):
    client = _client(tmp_path)
    r = client.post("/forecast", json={"dataset_id": "x", "horizon_days": 31,
                    "location": "40.7,-74.0"})
    assert r.status_code == 422
    api.app.dependency_overrides.clear()


def test_forecast_defaults_horizon_days_to_seven(tmp_path):
    client = _client(tmp_path)
    csv = "date,item,quantity\n" + "".join(
        f"2026-04-{d:02d},cabbage,{20 + d % 3}\n" for d in range(1, 29))
    r = client.post("/upload", files={"file": ("s.csv", io.BytesIO(csv.encode()),
                    "text/csv")})
    ds_id = r.json()["dataset_id"]
    f = client.post("/forecast", json={"dataset_id": ds_id, "location": "40.7,-74.0"})
    assert f.status_code == 200
    api.app.dependency_overrides.clear()
```

- [ ] **Step 2: Update `test_pipeline.py`'s existing call site**

In `backend/tests/test_pipeline.py`, change:

```python
def test_run_forecast_returns_adjusted_items(sample_sales):
    resp = run_forecast(sample_sales, "week", "40.7,-74.0", _Weather(), _Holidays(), _LLM())
```

to:

```python
def test_run_forecast_returns_adjusted_items(sample_sales):
    resp = run_forecast(sample_sales, 7, "40.7,-74.0", _Weather(), _Holidays(), _LLM())
```

- [ ] **Step 3: Run tests to verify they fail against current code**

Run: `cd backend && pytest -q tests/test_api.py tests/test_pipeline.py`
Expected: FAIL — `test_forecast_rejects_horizon_days_out_of_range` and `test_forecast_defaults_horizon_days_to_seven` fail because `horizon` is still a required field with no `horizon_days` field to validate; the modified existing tests fail with a 422 (unknown/missing `horizon` field) instead of 200/expected status.

- [ ] **Step 4: Update `api.py`**

Add `Field` to the pydantic import (line 8):

```python
from pydantic import BaseModel, Field, field_validator
```

Replace the `ForecastRequest` class:

```python
class ForecastRequest(_LocatedRequest):
    dataset_id: str
    horizon_days: int = Field(default=7, ge=1, le=30)
```

Update the `/forecast` handler to pass the renamed field:

```python
@app.post("/forecast")
def forecast(req: ForecastRequest, deps: dict = Depends(get_deps)):
    try:
        records = deps["store"].load(req.dataset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="dataset not found")
    return run_forecast(records, req.horizon_days, req.location,
                        deps["weather"], deps["holidays"], deps["llm"])
```

- [ ] **Step 5: Update `pipeline.py`**

Delete the `_HORIZON` dict and change `run_forecast`'s signature/body:

```python
import datetime
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale


def run_forecast(records: list[SalesRecord], horizon_days: int, location: str,
                 weather_src, holiday_src, llm) -> ForecastResponse:
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


def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
```

(Only the `_HORIZON` dict and `run_forecast`'s first two lines change; `run_sourcing`/`run_rationale` are shown for context and are unchanged.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && pytest -q`
Expected: PASS — full backend suite green (this also catches any other file that still references the old `horizon` field, since none should exist per the earlier `grep` in the spec).

- [ ] **Step 7: Commit**

```bash
git add backend/wastewise/api.py backend/wastewise/pipeline.py backend/tests/test_api.py backend/tests/test_pipeline.py
git commit -m "feat: replace day/week horizon enum with a validated horizon_days int"
```

---

### Task 2: Frontend — `Horizon` type, wizard defaults, and API client contract

**Files:**
- Modify: `frontend/lib/types.ts` (`Horizon` type)
- Modify: `frontend/lib/store.tsx` (`DEFAULTS.horizon`)
- Modify: `frontend/lib/api.ts` (`runForecast` request body)
- Modify: `frontend/__tests__/store.test.tsx` (defaults + rehydration assertions)
- Modify: `frontend/__tests__/api.test.ts` (call sites + new body-shape assertion)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Horizon = number` (days-from-today) — consumed by Task 4's `HorizonPicker` props and Task 5's Setup/Forecast/Stepper pages. `runForecast(datasetId: string, horizon: Horizon, location: string)` now POSTs `{ dataset_id, horizon_days: horizon, location }` — this is the exact body shape Task 1's backend now expects.

- [ ] **Step 1: Update `store.test.tsx` to the new numeric contract**

In `frontend/__tests__/store.test.tsx`:

```typescript
  it("exposes sensible defaults", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.location).toBe("40.7,-74.0");
    expect(result.current.horizon).toBe(7);
    expect(result.current.datasetId).toBeNull();
  });
```

```typescript
  it("rehydrates persisted state on mount", () => {
    window.sessionStorage.setItem("ww_state", JSON.stringify({ datasetId: "seed", horizon: 3 }));
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.datasetId).toBe("seed");
    expect(result.current.horizon).toBe(3);
  });
```

- [ ] **Step 2: Update `api.test.ts` to the new numeric contract and add a body-shape assertion**

Change all four `runForecast("ds1", "week", "40.7,-74.0")` call sites to `runForecast("ds1", 7, "40.7,-74.0")`, and append this new test at the end of the `describe` block:

```typescript
  it("sends horizon_days (not horizon) in the forecast request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DEMO_FORECAST));
    vi.stubGlobal("fetch", fetchMock);
    await runForecast("ds1", 12, "40.7,-74.0");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      dataset_id: "ds1",
      horizon_days: 12,
      location: "40.7,-74.0",
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail against current code**

Run: `cd frontend && npm test -- store.test.tsx api.test.ts`
Expected: FAIL — `defaults` test expects `7` but store still returns `"week"`; `rehydrates` test expects `3` but gets `"day"` semantics broken; the new body-shape test fails because the client still sends `{ horizon: 12 }` not `{ horizon_days: 12 }`.

- [ ] **Step 4: Update `types.ts`**

```typescript
export type Horizon = number;
```

- [ ] **Step 5: Update `store.tsx`'s `DEFAULTS`**

```typescript
const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: 7,
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
  rationale: null,
};
```

- [ ] **Step 6: Update `api.ts`'s `runForecast`**

```typescript
export function runForecast(datasetId: string, horizon: Horizon, location: string): Promise<ForecastResponse> {
  return call("/forecast", jsonInit({ dataset_id: datasetId, horizon_days: horizon, location }), DEMO_FORECAST);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend && npm test -- store.test.tsx api.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/store.tsx frontend/lib/api.ts frontend/__tests__/store.test.tsx frontend/__tests__/api.test.ts
git commit -m "feat: change wizard horizon from a day/week string to a day-count number"
```

---

### Task 3: Install the shadcn `base-nova` Calendar primitive

**Files:**
- Create: `frontend/components/ui/calendar.tsx` (generated by `shadcn add`, then patched)
- Create: `frontend/__tests__/calendar.test.tsx`
- Modify: `frontend/package.json`, `frontend/package-lock.json` (new deps: `react-day-picker`, `date-fns`)

**Interfaces:**
- Produces: `Calendar` component from `@/components/ui/calendar`, `React.ComponentProps<typeof DayPicker>` props (notably `mode`, `selected`, `onSelect`, `disabled`, `defaultMonth`) — consumed by Task 4's `HorizonPicker`.

- [ ] **Step 1: Write the failing smoke test**

Create `frontend/__tests__/calendar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Calendar } from "@/components/ui/calendar";

describe("Calendar", () => {
  it("renders without throwing", () => {
    const { container } = render(<Calendar mode="single" />);
    expect(container.querySelector('[data-slot="calendar"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- calendar.test.tsx`
Expected: FAIL with a module-resolution error — `@/components/ui/calendar` does not exist yet.

- [ ] **Step 3: Install the calendar component from the shadcn registry**

Run from `frontend/`:

```bash
npx shadcn@latest add calendar
```

This creates `components/ui/calendar.tsx` and adds `react-day-picker` and `date-fns` to `package.json`/`package-lock.json`.

- [ ] **Step 4: Patch the generated file's broken icon import**

The registry's `Chevron` sub-component imports `IconPlaceholder` from `@/app/(create)/components/icon-placeholder` — a helper that exists only in shadcn's own demo app, not this project (confirmed via `grep -r IconPlaceholder frontend/` returning no results). Every other file in `components/ui/` imports icons directly from `lucide-react` instead (see `select.tsx`'s `ChevronDownIcon`/`ChevronUpIcon`). In the newly created `frontend/components/ui/calendar.tsx`:

Remove this import:

```tsx
import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"
```

Add this import instead:

```tsx
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
```

Replace the `Chevron` component (inside the `components={{ ... }}` block) from:

```tsx
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <IconPlaceholder
                lucide="ChevronLeftIcon"
                tabler="IconChevronLeft"
                hugeicons="ArrowLeftIcon"
                phosphor="CaretLeftIcon"
                remixicon="RiArrowLeftSLine"
                className={cn("cn-rtl-flip size-4", className)}
                {...props}
              />
            )
          }

          if (orientation === "right") {
            return (
              <IconPlaceholder
                lucide="ChevronRightIcon"
                tabler="IconChevronRight"
                hugeicons="ArrowRightIcon"
                phosphor="CaretRightIcon"
                remixicon="RiArrowRightSLine"
                className={cn("cn-rtl-flip size-4", className)}
                {...props}
              />
            )
          }

          return (
            <IconPlaceholder
              lucide="ChevronDownIcon"
              tabler="IconChevronDown"
              hugeicons="ArrowDownIcon"
              phosphor="CaretDownIcon"
              remixicon="RiArrowDownSLine"
              className={cn("size-4", className)}
              {...props}
            />
          )
        },
```

to:

```tsx
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("cn-rtl-flip size-4", className)} {...props} />
          }
          if (orientation === "right") {
            return <ChevronRightIcon className={cn("cn-rtl-flip size-4", className)} {...props} />
          }
          return <ChevronDownIcon className={cn("size-4", className)} {...props} />
        },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- calendar.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/components/ui/calendar.tsx frontend/__tests__/calendar.test.tsx frontend/package.json frontend/package-lock.json
git commit -m "feat: add the shadcn base-nova calendar primitive"
```

---

### Task 4: `HorizonPicker` component

**Files:**
- Create: `frontend/components/ui/horizon-picker.tsx`
- Create: `frontend/__tests__/horizon-picker.test.tsx`

**Interfaces:**
- Consumes: `Calendar` from `@/components/ui/calendar` (Task 3), `Button` from `@/components/ui/button`, `Horizon = number` type (Task 2).
- Produces: `HorizonPicker({ value: number; onChange: (days: number) => void })` — consumed by Task 5's Setup page. `value`/`onChange` use the same "days from today" number as the wizard's `horizon` field.

- [ ] **Step 1: Write the failing test file**

Create `frontend/__tests__/horizon-picker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// HorizonPicker's job is to compute the right min/max/selected dates and
// translate calendar clicks into a day count — not to re-test react-day-picker's
// own click/keyboard behavior (that's the vendored Calendar's concern, smoke-tested
// in calendar.test.tsx). Stubbing Calendar keeps this test fast and independent of
// react-day-picker's exact DOM/ARIA output.
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: {
    selected?: Date;
    disabled?: { before: Date; after: Date };
    onSelect: (d: Date) => void;
  }) => (
    <div data-testid="calendar-stub">
      <span data-testid="selected">{props.selected?.toISOString()}</span>
      <span data-testid="min">{props.disabled?.before.toISOString()}</span>
      <span data-testid="max">{props.disabled?.after.toISOString()}</span>
      <button onClick={() => props.onSelect(new Date(2026, 6, 20))}>pick-a-date</button>
    </div>
  ),
}));

import { HorizonPicker } from "@/components/ui/horizon-picker";

describe("HorizonPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15)); // 2026-07-15, a fixed "today"
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onChange with the right day count when a quick-pick is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<HorizonPicker value={7} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(onChange).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "2 weeks" }));
    expect(onChange).toHaveBeenCalledWith(14);
  });

  it("passes today+1 as min and today+30 as max to the calendar", () => {
    render(<HorizonPicker value={7} onChange={vi.fn()} />);
    expect(screen.getByTestId("min").textContent).toBe(new Date(2026, 6, 16).toISOString());
    expect(screen.getByTestId("max").textContent).toBe(new Date(2026, 7, 14).toISOString());
  });

  it("derives the selected calendar date from value", () => {
    render(<HorizonPicker value={3} onChange={vi.fn()} />);
    expect(screen.getByTestId("selected").textContent).toBe(new Date(2026, 6, 18).toISOString());
  });

  it("converts a calendar day click into a day count via onChange", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<HorizonPicker value={7} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "pick-a-date" }));
    // stub always picks 2026-07-20; system time is 2026-07-15 -> 5 days out
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("falls back to a 7-day default caption when value is not a valid number", () => {
    render(<HorizonPicker value={NaN} onChange={vi.fn()} />);
    expect(screen.getByText(/forecasting 7 days ahead/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- horizon-picker.test.tsx`
Expected: FAIL with a module-resolution error — `@/components/ui/horizon-picker` does not exist yet.

- [ ] **Step 3: Implement `HorizonPicker`**

Create `frontend/components/ui/horizon-picker.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";

const MAX_HORIZON_DAYS = 30;

const QUICK_PICKS = [
  { label: "Tomorrow", days: 1 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

interface HorizonPickerProps {
  value: number;
  onChange: (days: number) => void;
}

export function HorizonPicker({ value, onChange }: HorizonPickerProps) {
  const today = startOfToday();
  const min = addDays(today, 1);
  const max = addDays(today, MAX_HORIZON_DAYS);
  const safeValue = Number.isFinite(value) && value >= 1 && value <= MAX_HORIZON_DAYS ? value : 7;
  const selected = addDays(today, safeValue);
  const formattedEnd = selected.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {QUICK_PICKS.map((qp) => (
          <Button
            key={qp.days}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange(qp.days)}
            className={
              safeValue === qp.days
                ? "bg-foreground text-background hover:bg-foreground/80"
                : "border border-foreground/25 bg-transparent hover:bg-foreground/5"
            }
          >
            {qp.label}
          </Button>
        ))}
      </div>
      <div className="border border-foreground/25 bg-card p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(daysBetween(today, date));
          }}
          disabled={{ before: min, after: max }}
        />
      </div>
      <p className="ww-num text-[11px] text-muted-foreground">
        Forecasting {safeValue} day{safeValue === 1 ? "" : "s"} ahead &mdash; through {formattedEnd}.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- horizon-picker.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/horizon-picker.tsx frontend/__tests__/horizon-picker.test.tsx
git commit -m "feat: add HorizonPicker (quick-picks + calendar grid)"
```

---

### Task 5: Wire `HorizonPicker` into Setup, Stepper, and Forecast copy

**Files:**
- Modify: `frontend/app/setup/page.tsx`
- Modify: `frontend/components/stepper.tsx`
- Modify: `frontend/app/forecast/page.tsx`
- Modify: `frontend/__tests__/setup.test.tsx`
- Modify: `frontend/__tests__/stepper.test.tsx`

**Interfaces:**
- Consumes: `HorizonPicker` (Task 4), `horizon: number` from `useWizard()`/`WizardContext` (Task 2).

- [ ] **Step 1: Write the failing Setup-page integration test**

In `frontend/__tests__/setup.test.tsx`, append inside the `describe("Setup screen", ...)` block:

```typescript
  it("updates the wizard horizon when a quick-pick is selected", async () => {
    renderWithWizard(<SetupPage />);
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await waitFor(() => {
      const state = JSON.parse(window.sessionStorage.getItem("ww_state")!);
      expect(state.horizon).toBe(1);
    });
  });
```

- [ ] **Step 2: Write the failing Stepper test**

In `frontend/__tests__/stepper.test.tsx`, add the import and a new test:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "@/components/stepper";
import { renderWithWizard } from "./test-utils";

describe("Stepper", () => {
  it("renders the four step labels", () => {
    render(<Stepper current={0} />);
    for (const label of ["Setup", "Forecast", "Sourcing", "Order"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the current step with aria-current", () => {
    render(<Stepper current={2} />);
    expect(screen.getByText("Sourcing").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
  });

  it("shows the horizon as a day count in the parameters panel", () => {
    renderWithWizard(<Stepper current={0} />, { initial: { horizon: 3, location: "40.7,-74.0" } });
    expect(screen.getByText("3 days")).toBeInTheDocument();
  });
});
```

(This replaces the whole file's contents — only the import block and the new test are additions; the first two `it` blocks are unchanged.)

- [ ] **Step 3: Run both test files to verify the new tests fail**

Run: `cd frontend && npm test -- setup.test.tsx stepper.test.tsx`
Expected: FAIL — Setup's test fails because there's no "Tomorrow" button yet (still the old `<select>`); Stepper's test fails because the parameters panel renders "7 days" is not it—actually renders nothing matching "3 days" (old code renders `capitalize` text of the raw value, i.e. would render "3", not "3 days").

- [ ] **Step 4: Update `setup/page.tsx`**

Two of the existing import lines change (leave every other import — `useEffect`/`useRef`/`useState`, `dynamic`, `useRouter`, `uploadCsv`/`ApiError`, `setDemoMode`, `Button`, `CsvDropzone`, and the `LocationPicker` dynamic import block — untouched).

Replace:

```tsx
import type { Horizon, UploadResponse } from "@/lib/types";
```

with:

```tsx
import type { UploadResponse } from "@/lib/types";
```

Replace:

```tsx
import { Label } from "@/components/ui/label";
```

with:

```tsx
import { HorizonPicker } from "@/components/ui/horizon-picker";
```

(`Label` becomes unused on this page once the `<select>` block below is replaced — `HorizonPicker` takes its place in the import list.)

Replace the `1.3 — Horizon` block:

```tsx
      <div className="space-y-2">
        <Label htmlFor="horizon" className="ww-label">
          1.3 &mdash; Horizon
        </Label>
        <select
          id="horizon"
          className="ww-num h-9 w-full border border-foreground/25 bg-card px-3 text-sm focus:border-accent focus:outline-none"
          value={horizon}
          onChange={(e) => set({ horizon: e.target.value as Horizon })}
        >
          <option value="day">Next day</option>
          <option value="week">Next week</option>
        </select>
      </div>
```

with:

```tsx
      <div>
        <p className="ww-label mb-2">1.3 &mdash; Horizon</p>
        <HorizonPicker value={horizon} onChange={(d) => set({ horizon: d })} />
      </div>
```

- [ ] **Step 5: Update `stepper.tsx`**

Replace:

```tsx
            {horizon && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="ww-label text-muted-foreground">Horizon</dt>
                <dd className="ww-num capitalize">{horizon}</dd>
              </div>
            )}
```

with:

```tsx
            {horizon && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="ww-label text-muted-foreground">Horizon</dt>
                <dd className="ww-num">{horizon} day{horizon === 1 ? "" : "s"}</dd>
              </div>
            )}
```

- [ ] **Step 6: Update `forecast/page.tsx`'s copy**

Replace:

```tsx
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Per-item demand for the next {horizon}. The base model predicts sales
          from your history; an LLM then nudges each quantity up or down for
          weather and public holidays.
        </p>
```

with:

```tsx
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Per-item demand for the next {horizon} day{horizon === 1 ? "" : "s"}. The
          base model predicts sales from your history; an LLM then nudges each
          quantity up or down for weather and public holidays.
        </p>
```

- [ ] **Step 7: Run the two updated test files to verify they pass**

Run: `cd frontend && npm test -- setup.test.tsx stepper.test.tsx`
Expected: PASS

- [ ] **Step 8: Run the full frontend and backend suites as a final regression check**

Run: `cd frontend && npm test`
Expected: PASS (all files, including `forecast.test.tsx` and `order.test.tsx`, which don't assert on horizon text and should be unaffected)

Run: `cd backend && pytest -q`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/app/setup/page.tsx frontend/components/stepper.tsx frontend/app/forecast/page.tsx frontend/__tests__/setup.test.tsx frontend/__tests__/stepper.test.tsx
git commit -m "feat: wire HorizonPicker into Setup, Stepper, and Forecast copy"
```
