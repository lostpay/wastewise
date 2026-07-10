# WasteWise — Horizon Calendar Picker Design

Date: 2026-07-10
Status: Approved for implementation

## Problem

The Setup page's "1.3 — Horizon" control is a two-option `<select>`
(`day` | `week`). The forecast start is always "the day after the
uploaded data ends" — only the *length* of the forecast window varies —
but the UI artificially limits that length to two hardcoded values. The
user wants to pick any forecast length via a calendar, up to a sane cap.

The underlying model already supports this: `forecast_items`,
`baseline_forecast`, and `_future_rows` in
`backend/wastewise/forecasting/` all take a generic `horizon_days: int`.
The only thing constraining the app to `{1, 7}` is
`pipeline.py`'s `_HORIZON = {"day": 1, "week": 7}` lookup table and the
`Literal["day", "week"]` request field. Removing that translation layer
is a simplification, not new machinery.

## Scope decisions (confirmed with user)

- **End-date picker, not a true range picker.** The calendar lets the
  user pick how far out to forecast (an end date); the start stays
  implicitly "day after the data ends," exactly as today. A true
  start+end range picker would require the model to forecast from an
  arbitrary future start, which is out of scope.
- **30-day cap.** `lag7`/`roll7` features degrade the further out you
  forecast — past ~30 days the model is mostly repeating the recent
  7-day average. The calendar disables dates beyond today+30 as a
  numerical safeguard, not just a UX nicety.
- **Calendar UI is anchored to "today," not the dataset's actual last
  row.** The dataset's real last-data-date isn't known at Setup time
  (CSV isn't parsed yet). This matches current behavior, where the
  day/week choice is already made abstractly, before upload. What the
  picker actually produces is a `horizon_days` integer; the backend
  still computes the real window from the dataset's last row +
  `horizon_days`, unchanged.
- **Quick-pick shortcuts + full calendar grid**, not calendar-only.
  Buttons for Tomorrow (1d) / 1 week (7d) / 2 weeks (14d) sit above the
  grid for the common cases; the grid covers everything else up to the
  cap.

## Backend — `backend/wastewise/api.py`, `backend/wastewise/pipeline.py`

`ForecastRequest.horizon: Literal["day", "week"] = "week"` becomes:

```python
horizon_days: int = Field(default=7, ge=1, le=30)
```

`pipeline.py` drops the `_HORIZON` dict entirely; `run_forecast` takes
`horizon_days: int` directly and passes it straight through to
`forecast_items` and the holiday-range lookup (both already accept an
int). No other backend file references `horizon`.

Out-of-range or non-integer `horizon_days` 422s via Pydantic before
reaching `run_forecast`, the same pattern as the existing `location`
regex validator on `_LocatedRequest`.

## Frontend

### Types & state

- `frontend/lib/types.ts`: `export type Horizon = number;` (was
  `"day" | "week"`) — represents days-from-today.
- `frontend/lib/store.tsx`: `DEFAULTS.horizon` changes from `"week"` to
  `7`. A stale pre-migration `sessionStorage` value (old string
  `"day"`/`"week"`) is defended against in the picker component (see
  below) rather than in the store, since the store's job is just to
  persist whatever shape it's given.
- `frontend/lib/api.ts`: `runForecast(datasetId, horizon, location)`
  sends `{ dataset_id: datasetId, horizon_days: horizon, location }`
  instead of `{ ..., horizon, ... }`.

### New component — `frontend/components/ui/calendar.tsx`

Installed via `npx shadcn add calendar` (verified against the live
registry: this project's `components.json` is configured with
`"style": "base-nova"`, and the registry's `base-nova` calendar is
`react-day-picker` + `date-fns` under a shadcn wrapper — both get added
as new npm dependencies). Pure grid primitive, no app logic — same role
as the existing `select.tsx`/`switch.tsx` primitives.

**Known registry quirk to fix on install:** the registry payload's
`Chevron` component imports `IconPlaceholder` from
`@/app/(create)/components/icon-placeholder` — a helper that only
exists in shadcn's own demo app, not in this project (confirmed: no
`IconPlaceholder` reference anywhere in `frontend/`). Every other
`components/ui/*.tsx` file in this project instead imports icons
directly from `lucide-react` (e.g. `select.tsx` imports `ChevronDownIcon`,
`ChevronUpIcon` from `lucide-react`). After running the CLI, replace the
`Chevron` component's body with direct `ChevronLeftIcon`/`ChevronRightIcon`/
`ChevronDownIcon` imports from `lucide-react`, matching `select.tsx`'s
pattern, so the build doesn't reference a nonexistent module.

### New component — `frontend/components/ui/horizon-picker.tsx`

```ts
interface HorizonPickerProps {
  value: number;       // days from today
  onChange: (days: number) => void;
}
```

- Computes `today`, `min = today + 1 day`, `max = today + 30 days`
  internally (not props — this cap is a model constraint, not a
  per-call configuration).
- If `value` is not a finite number in `[1, 30]` (covers the stale
  `sessionStorage` string case above), treats it as `7` for display
  purposes without mutating the store — the next real selection
  overwrites it.
- Renders three quick-pick buttons (1 / 7 / 14 days) that call
  `onChange` directly, styled consistently with the existing
  `Button variant="secondary"` used elsewhere on the Setup page.
- Renders `Calendar` in single-date mode, `disabled={{ before: min,
  after: max }}`, with the selected date derived from `today + value`
  days so quick-picks and grid clicks stay visually in sync.
- Shows a caption: "Forecasting `{value}` day{s} ahead — through
  `{formatted end date}`."

### Setup page — `frontend/app/setup/page.tsx`

Replace the `1.3 — Horizon` `<select>` block with:

```tsx
<HorizonPicker value={horizon} onChange={(d) => set({ horizon: d })} />
```

### Forecast page — `frontend/app/forecast/page.tsx`

"Per-item demand for the next {horizon}." →
"Per-item demand for the next {horizon} day{horizon === 1 ? "" : "s"}."

### Stepper — `frontend/components/stepper.tsx`

The sidebar summary's `<dd className="ww-num capitalize">{horizon}</dd>`
(previously rendering "Day"/"Week") becomes
`{horizon} day{horizon === 1 ? "" : "s"}`.

## Error handling

- **Backend**: Pydantic `Field(ge=1, le=30)` rejects out-of-range values
  with a 422 before `run_forecast` runs — no manual validation code
  needed.
- **Frontend**: `HorizonPicker` cannot produce an out-of-range value —
  calendar dates outside `[min, max]` are disabled, quick-picks are
  hardcoded in-range — so there's no client-side error branch to build.
  The stale-value fallback above is the only defensive case.

## Testing

Matches existing Vitest (frontend) + pytest (backend) conventions.

**Backend** (`backend/tests/test_api.py`):
- Update the two existing `horizon: "week"` call sites to
  `horizon_days: 7`.
- Add: `horizon_days: 31` → 422; `horizon_days: 0` → 422; omitted
  `horizon_days` → defaults to 7 and succeeds.

**Frontend**:
- New `frontend/__tests__/horizon-picker.test.tsx`: quick-pick click
  sets the correct day count and calls `onChange`; calendar click on a
  valid date sets the correct day count; dates outside `[min, max]`
  render disabled and don't fire `onChange` on click.
- Update `frontend/__tests__/setup.test.tsx` (currently drives the old
  `<select>` — switch to driving `HorizonPicker`'s quick-pick buttons,
  which is simpler to assert on than simulating a calendar click).
- Update `frontend/__tests__/stepper.test.tsx` and
  `frontend/__tests__/store.test.tsx` wherever they assert `horizon` as
  a `"day"`/`"week"` string — switch fixtures to numeric days.
