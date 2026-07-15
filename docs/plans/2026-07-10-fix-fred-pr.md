# Fix PR #9 (FRED benchmark + UI clarity + retro redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the issues found in review of `feat/fred-price-benchmark` (PR #9) before merge: finish the USDA→FRED rename everywhere (not just the price adapter's internals), fix a request/parsing mismatch that silently defeats the missing-value fallback, unify "market benchmark" copy into the new "US retail average (BLS via FRED)" language across backend prompts, frontend, and demo fixtures, restore semantic table markup on the forecast page, and correct the self-contradicting `docs/STATUS.md`.

**Architecture:** No architectural change — this is a targeted cleanup of the branch that's already open as PR #9. Work happens on a local branch tracking `origin/feat/fred-price-benchmark`; each task is a small commit pushed to that same branch so the existing PR updates in place.

**Tech Stack:** Python/FastAPI + pytest/respx (backend), Next.js/TypeScript + Vitest (frontend).

## Global Constraints

- Every remaining "USDA"/"MARS" reference in code, config, and *current-state* docs must become FRED/BLS-flavored. Do **not** touch `docs/specs/*.md` or `docs/plans/2026-07-07-wastewise-backend.md` — those are dated historical design docs, not claims about current state, and editing them would falsify the record of what was actually planned at the time.
- Keep the generic domain vocabulary (`get_wholesale_price`, `"wholesale"` key in `get_deps()`, `_Wholesale` fakes in tests, `benchmark` variable names) — those describe the *role* the adapter plays, not the provider, and four other test files (`test_api.py`, `test_integration.py`, `test_pipeline.py`, `test_sourcing.py`) already depend on that generic name. Renaming it would be pure churn outside what was asked.
- New copy uses the exact phrase **"US retail average"** (optionally qualified as "US retail average (BLS, via FRED)" on first mention in a given file) — matches the wording already shipped on `sourcing/page.tsx` and `price-table.tsx`'s legend in this PR.
- Every task must leave `pytest -q` (backend) and `npx vitest run` + `npx tsc --noEmit` (frontend) green before committing.
- Run all backend commands from `backend/`, all frontend commands from `frontend/`.

---

### Task 1: Rename the price adapter from USDA to FRED

**Files:**
- Create: `backend/wastewise/adapters/price_fred.py`
- Delete: `backend/wastewise/adapters/price_usda.py`
- Create: `backend/tests/test_price_fred.py`
- Delete: `backend/tests/test_price_usda.py`
- Modify: `backend/wastewise/config.py`
- Modify: `backend/wastewise/api.py`

**Interfaces:**
- Produces: `FredWholesale(api_key: str, cache: FileCache, client: httpx.Client | None = None)` with `.get_wholesale_price(item: str) -> float | None` — same signature as the old `USDAWholesale`, so `pipeline.py`'s `run_sourcing(...)` call site is untouched.
- Produces: `Settings.fred_api_key: str` (replaces `usda_api_key`), which `pydantic-settings` maps to the `FRED_API_KEY` env var.

- [ ] **Step 1: Create the renamed adapter file**

Write `backend/wastewise/adapters/price_fred.py` with the same body as the current `price_usda.py`, renaming only the class:

```python
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
    "rice": "APU0000701322",
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
                "limit": 1,
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
```

Delete the old file:

```bash
rm backend/wastewise/adapters/price_usda.py
```

- [ ] **Step 2: Rename the test file and its imports**

Write `backend/tests/test_price_fred.py`:

```python
import httpx
import respx
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_fred import FredWholesale

BASE = "https://api.stlouisfed.org/fred/series/observations"


@respx.mock
def test_get_wholesale_price_returns_latest_observation(tmp_path):
    body = {"observations": [{"date": "2026-05-01", "value": "2.19"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("eggs") == 2.19


@respx.mock
def test_get_wholesale_price_skips_missing_values(tmp_path):
    body = {"observations": [{"date": "2026-05-01", "value": "."},
                             {"date": "2026-04-01", "value": "3.29"}]}
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(200, json=body))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("chicken") == 3.29


def test_get_wholesale_price_unknown_item_returns_none(tmp_path):
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("paneer") is None


@respx.mock
def test_get_wholesale_price_error_returns_none(tmp_path):
    respx.get(url__startswith=BASE).mock(return_value=httpx.Response(503))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    assert src.get_wholesale_price("eggs") is None
```

Delete the old test file:

```bash
rm backend/tests/test_price_usda.py
```

- [ ] **Step 3: Update `config.py`**

In `backend/wastewise/config.py`, change:

```python
    usda_api_key: str = "changeme"
```

to:

```python
    fred_api_key: str = "changeme"
```

- [ ] **Step 4: Update `api.py`**

In `backend/wastewise/api.py`, change the import:

```python
from wastewise.adapters.price_usda import USDAWholesale
```

to:

```python
from wastewise.adapters.price_fred import FredWholesale
```

And in `get_deps()`, change:

```python
        "wholesale": USDAWholesale(s.usda_api_key, cache),
```

to:

```python
        "wholesale": FredWholesale(s.fred_api_key, cache),
```

- [ ] **Step 5: Run backend tests**

Run: `cd backend && pytest -q`
Expected: PASS, same test count as before (4 tests in the renamed file, none lost).

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/adapters/price_fred.py backend/tests/test_price_fred.py backend/wastewise/config.py backend/wastewise/api.py
git rm backend/wastewise/adapters/price_usda.py backend/tests/test_price_usda.py
git commit -m "refactor: rename USDA price adapter to FredWholesale"
```

---

### Task 2: Fix the FRED request so the missing-value fallback can actually fire

**Files:**
- Modify: `backend/wastewise/adapters/price_fred.py`
- Test: `backend/tests/test_price_fred.py`

**Interfaces:**
- Consumes: `FredWholesale` from Task 1 (same file, no signature change).

The adapter requests `"limit": 1` from FRED but `_latest_price` loops over `observations` looking for the first non-`"."` value — with `limit=1`, FRED only ever returns one row, so if that single observation is `"."` (a just-closed reporting period that BLS hasn't finalized yet), `get_wholesale_price` returns `None` for the whole item instead of falling back to an earlier month. The existing `test_get_wholesale_price_skips_missing_values` test only proves the *parsing* loop works — it never exercises the real `limit=1` request shape.

- [ ] **Step 1: Write a failing test asserting the real request requests more than one observation**

Add to `backend/tests/test_price_fred.py`:

```python
@respx.mock
def test_get_wholesale_price_requests_enough_history_to_skip_missing(tmp_path):
    route = respx.get(url__startswith=BASE).mock(
        return_value=httpx.Response(200, json={"observations": [{"date": "2026-05-01", "value": "2.19"}]}))
    src = FredWholesale("key", FileCache(str(tmp_path)))
    src.get_wholesale_price("eggs")
    sent_limit = int(route.calls.last.request.url.params["limit"])
    assert sent_limit >= 6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_price_fred.py::test_get_wholesale_price_requests_enough_history_to_skip_missing -v`
Expected: FAIL — `assert 1 >= 6`

- [ ] **Step 3: Fix the request**

In `backend/wastewise/adapters/price_fred.py`, change:

```python
                "limit": 1,
```

to:

```python
                "limit": 6,  # enough months that a "." (unfinalized) latest value can fall through to an earlier one
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/test_price_fred.py -v`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/adapters/price_fred.py backend/tests/test_price_fred.py
git commit -m "fix: request enough FRED history for the missing-value skip to actually engage"
```

---

### Task 3: Rename the deploy-facing env var from USDA_API_KEY to FRED_API_KEY

**Files:**
- Modify: `render.yaml`
- Modify: `backend/.env.example`
- Modify: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: `Settings.fred_api_key` from Task 1 — `pydantic-settings` uppercases the field name, so the env var must be exactly `FRED_API_KEY`.

⚠️ **Manual step required, not automatable from this repo:** if `USDA_API_KEY` is already set as a Render secret for the `wastewise-backend` service, it must be renamed to `FRED_API_KEY` in the Render dashboard (Environment tab) before or immediately after this deploys, or the live service will silently fall back to `"changeme"` and every sourcing call will 401. Flag this to whoever owns the Render deploy.

- [ ] **Step 1: Update `render.yaml`**

Change:

```yaml
      - key: USDA_API_KEY
        sync: false
```

to:

```yaml
      - key: FRED_API_KEY
        sync: false
```

- [ ] **Step 2: Update `backend/.env.example`**

Change:

```
USDA_API_KEY=changeme
```

to:

```
FRED_API_KEY=changeme
```

- [ ] **Step 3: Update `docs/DEPLOY.md`**

Change:

```
   - `USDA_API_KEY`, `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` = optional (leave
     blank to use graceful fallbacks).
```

to:

```
   - `FRED_API_KEY`, `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` = optional (leave
     blank to use graceful fallbacks).
```

- [ ] **Step 4: Verify no other `USDA_API_KEY`/`usda_api_key` references remain**

Run: `git grep -in "usda" -- . ':!docs/specs' ':!docs/plans' ':!docs/reviews'`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add render.yaml backend/.env.example docs/DEPLOY.md
git commit -m "chore: rename USDA_API_KEY env var to FRED_API_KEY in deploy config"
```

---

### Task 4: Unify sourcing copy on "US retail average" (backend LLM prompt + fallback)

**Files:**
- Modify: `backend/wastewise/agents/sourcing.py`
- Test: `backend/tests/test_sourcing.py`

**Interfaces:**
- Consumes: `POLine`, `SourcingResponse` from `wastewise.models` (unchanged).
- Produces: `source_order(items, wholesale, retail, llm, location) -> SourcingResponse` — signature unchanged; only the strings inside `note` change.

The PR's whole stated goal was to stop the sourcing screen from reading as a vague "market" — but the LLM `SYSTEM` prompt and the non-LLM fallback string in `sourcing.py` still say "market benchmark". Since real (non-mocked) LLM calls follow this prompt, the live sourcing notes keep the old language regardless of what the frontend renders around them.

- [ ] **Step 1: Write a failing test for the new fallback string**

Add to `backend/tests/test_sourcing.py`:

```python
class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("simulated LLM outage")


def test_source_order_fallback_note_uses_retail_average_language():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _RaisingLLM(), "loc")
    assert resp.lines[0].note == "At or above the US retail average."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/test_sourcing.py::test_source_order_fallback_note_uses_retail_average_language -v`
Expected: FAIL — `assert 'At or above market benchmark.' == 'At or above the US retail average.'`

- [ ] **Step 3: Update the prompt and fallback strings**

In `backend/wastewise/agents/sourcing.py`, change:

```python
SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the market benchmark. Respond with plain text only.")
```

to:

```python
SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the US retail average benchmark (BLS, via FRED). "
          "Respond with plain text only.")
```

And change:

```python
        if benchmark and unit_price < benchmark:
            pct = round((benchmark - unit_price) / benchmark * 100)
            return f"{pct}% under market benchmark."
        return "At or above market benchmark."
```

to:

```python
        if benchmark and unit_price < benchmark:
            pct = round((benchmark - unit_price) / benchmark * 100)
            return f"{pct}% under the US retail average."
        return "At or above the US retail average."
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/test_sourcing.py -v`
Expected: PASS, including the new test and the two pre-existing ones (`test_source_order_picks_cheapest_and_computes_savings`, `test_source_order_falls_back_to_market_when_no_retail`), since neither asserts on the old note text.

Run: `cd backend && pytest -q`
Expected: PASS, full suite green.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "fix: point sourcing LLM prompt and fallback copy at US retail average instead of \"market benchmark\""
```

---

### Task 5: Update demo fixtures to match the new terminology

**Files:**
- Modify: `frontend/lib/demo.ts`

**Interfaces:**
- Consumes: `SourcingResponse` type from `frontend/lib/types` (unchanged).

Demo mode is the *default* experience whenever `NEXT_PUBLIC_API_URL` is unset (see `isDemoMode()` in this same file) — so anyone viewing the app without a live backend, including hackathon judges, sees `DEMO_SOURCING`'s notes verbatim. They currently still say "market benchmark", clashing with the sourcing page's new "US retail average (BLS via FRED)" framing right above the table.

- [ ] **Step 1: Update `DEMO_SOURCING` notes**

In `frontend/lib/demo.ts`, change:

```typescript
export const DEMO_SOURCING: SourcingResponse = {
  total: 618.4,
  savings: 92.0,
  lines: [
    { item: "cabbage", qty: 150, supplier: "Kroger", unit_price: 1.4, line_total: 210.0, note: "30% under market benchmark." },
    { item: "pork", qty: 118, supplier: "Kroger", unit_price: 1.4, line_total: 165.2, note: "30% under market benchmark." },
    { item: "chicken", qty: 196, supplier: "Kroger", unit_price: 1.24, line_total: 243.2, note: "38% under market benchmark." },
  ],
};
```

to:

```typescript
export const DEMO_SOURCING: SourcingResponse = {
  total: 618.4,
  savings: 92.0,
  lines: [
    { item: "cabbage", qty: 150, supplier: "Kroger", unit_price: 1.4, line_total: 210.0, note: "30% under the US retail average." },
    { item: "pork", qty: 118, supplier: "Kroger", unit_price: 1.4, line_total: 165.2, note: "30% under the US retail average." },
    { item: "chicken", qty: 196, supplier: "Kroger", unit_price: 1.24, line_total: 243.2, note: "38% under the US retail average." },
  ],
};
```

- [ ] **Step 2: Run the sourcing test suite to confirm nothing pinned the old string**

Run: `cd frontend && npx vitest run __tests__/sourcing.test.tsx`
Expected: PASS (existing assertions only check supplier count and the `$92` savings figure, not note text).

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/demo.ts
git commit -m "fix: update demo sourcing notes to say \"US retail average\" instead of \"market benchmark\""
```

---

### Task 6: Simplify and align `PriceTable`'s `noteText()`

**Files:**
- Modify: `frontend/components/price-table.tsx`

**Interfaces:**
- Consumes: `POLine` from `frontend/lib/types` (unchanged).

`noteText()` currently rewrites the note only when it exactly matches the *old* hardcoded fallback string `"At or above market benchmark."`. After Task 4, the backend never produces that string again — so this branch is now permanently dead code, and worse, if the real (non-mocked) LLM writes its own sentence, it will follow the new prompt from Task 4 and already say "US retail average" on its own. Delete the now-pointless exact-match branch instead of updating it to chase a string that no longer needs chasing.

- [ ] **Step 1: Simplify `noteText()`**

In `frontend/components/price-table.tsx`, change:

```typescript
function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using BLS national average as reference.";
  if (line.note === "At or above market benchmark.") return "At or above US retail average.";
  return line.note;
}
```

to:

```typescript
function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using the US retail average as reference.";
  return line.note;
}
```

- [ ] **Step 2: Run the frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS, all tests green (no test exercises `noteText` directly, so this is a behavior-preserving-or-improving simplification, not a risky change).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/price-table.tsx
git commit -m "refactor: drop dead exact-string rewrite in PriceTable.noteText now that the backend already says \"US retail average\""
```

---

### Task 7: Restore semantic `<table>` markup on the Forecast detail table

**Files:**
- Modify: `frontend/app/forecast/page.tsx`
- Test: `frontend/__tests__/forecast.test.tsx`

**Interfaces:**
- Consumes: `ForecastAdjustedItem` items from `forecast.items` (unchanged — `item`, `forecast`, `adjusted_qty`, `reason`), `ReasonBadge` component (unchanged, from Task 6's sibling file `reason-badge.tsx`, no changes needed there).

`PriceTable` (Tbl. 2) and `POTable` (Tbl. 3) both use real `<table>`/`<thead>`/`<tbody>` markup, but the forecast page's own "Tbl. 1 — Per-item detail" block is a `<ul>`/`<li>` styled with CSS grid to *look* like a table. It loses header/cell semantics that screen readers and `getByRole("table")`-style queries rely on, and it's inconsistent with the other two tables shipped in this same PR.

- [ ] **Step 1: Write a failing test for table semantics**

In `frontend/__tests__/forecast.test.tsx`, extend the existing `"renders adjusted items and reasons after forecasting"` test:

```typescript
  it("renders adjusted items and reasons after forecasting", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("cabbage")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Rain forecast lowers dine-in demand/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/18%/)).toBeInTheDocument(); // baseline_delta 0.18 -> "18%"
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /model/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run __tests__/forecast.test.tsx -t "renders adjusted items and reasons"`
Expected: FAIL — `Unable to find role="table"`.

- [ ] **Step 3: Replace the `<ul>`/`<li>` grid with a real `<table>`**

In `frontend/app/forecast/page.tsx`, replace:

```tsx
          <div>
            <p className="ww-label mb-2">Tbl. 1 — Per-item detail</p>
            <div className="border border-foreground/20">
              <div className="grid grid-cols-[1fr_5rem_5rem_5rem_1fr] items-center gap-4 border-b-2 border-foreground/60 bg-muted px-3 py-2">
                <span className="ww-label">Item</span>
                <span className="ww-label text-right">Model</span>
                <span className="ww-label text-right">Rec.</span>
                <span className="ww-label text-right">Δ</span>
                <span className="ww-label hidden text-right sm:block">Note</span>
              </div>
              <ul>
                {forecast.items.map((it, idx) => {
                  const delta = it.adjusted_qty - it.forecast;
                  const deltaPct = it.forecast ? (delta / it.forecast) * 100 : 0;
                  const sign = delta > 0 ? "+" : "";
                  // Down = saved-from-waste (green). Up = justified extra
                  // spend (amber). Zero = muted. Deliberately not "up=good"
                  // — this is a waste-reduction app, so shrinking a
                  // purchase is the product's success state.
                  const deltaColor =
                    delta < 0
                      ? "text-emerald-700"
                      : delta > 0
                        ? "text-amber-700"
                        : "text-muted-foreground";
                  return (
                    <li
                      key={it.item}
                      className={`grid grid-cols-[1fr_5rem_5rem_5rem_1fr] items-center gap-4 px-3 py-3 ${
                        idx > 0 ? "border-t border-dashed border-foreground/15" : ""
                      }`}
                    >
                      <span className="text-sm font-medium capitalize">{it.item}</span>
                      <span className="ww-num text-right text-sm text-muted-foreground">
                        {it.forecast.toFixed(1)}
                      </span>
                      <span className="ww-num text-right text-sm font-semibold">
                        {it.adjusted_qty.toFixed(1)}
                      </span>
                      <span className={`ww-num text-right text-xs ${deltaColor}`}>
                        {sign}
                        {delta.toFixed(1)}
                        <span className="ml-1 opacity-70">
                          ({sign}
                          {deltaPct.toFixed(0)}%)
                        </span>
                      </span>
                      <span className="hidden justify-end sm:flex">
                        <ReasonBadge reason={it.reason} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
```

with:

```tsx
          <div>
            <p className="ww-label mb-2">Tbl. 1 — Per-item detail</p>
            <div className="border border-foreground/20">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-foreground/60 bg-muted">
                    <th className="ww-label px-4 py-2 text-left">Item</th>
                    <th className="ww-label px-4 py-2 text-right">Model</th>
                    <th className="ww-label px-4 py-2 text-right">Rec.</th>
                    <th className="ww-label px-4 py-2 text-right">Δ</th>
                    <th className="ww-label hidden px-4 py-2 text-right sm:table-cell">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.items.map((it, idx) => {
                    const delta = it.adjusted_qty - it.forecast;
                    const deltaPct = it.forecast ? (delta / it.forecast) * 100 : 0;
                    const sign = delta > 0 ? "+" : "";
                    // Down = saved-from-waste (green). Up = justified extra
                    // spend (amber). Zero = muted. Deliberately not "up=good"
                    // — this is a waste-reduction app, so shrinking a
                    // purchase is the product's success state.
                    const deltaColor =
                      delta < 0
                        ? "text-emerald-700"
                        : delta > 0
                          ? "text-amber-700"
                          : "text-muted-foreground";
                    return (
                      <tr
                        key={it.item}
                        className={idx > 0 ? "border-t border-dashed border-foreground/15" : ""}
                      >
                        <td className="px-4 py-3 text-sm font-medium capitalize">{it.item}</td>
                        <td className="ww-num px-4 py-3 text-right text-sm text-muted-foreground">
                          {it.forecast.toFixed(1)}
                        </td>
                        <td className="ww-num px-4 py-3 text-right text-sm font-semibold">
                          {it.adjusted_qty.toFixed(1)}
                        </td>
                        <td className={`ww-num px-4 py-3 text-right text-xs ${deltaColor}`}>
                          {sign}
                          {delta.toFixed(1)}
                          <span className="ml-1 opacity-70">
                            ({sign}
                            {deltaPct.toFixed(0)}%)
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-right align-top sm:table-cell">
                          <ReasonBadge reason={it.reason} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run __tests__/forecast.test.tsx`
Expected: PASS, all 4 tests green.

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, no type errors.

Run: `cd frontend && npx vitest run`
Expected: PASS, full suite green (37+1 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/forecast/page.tsx frontend/__tests__/forecast.test.tsx
git commit -m "fix: use a semantic table for the forecast per-item detail view"
```

---

### Task 8: Manually verify each FRED/BLS series ID (no code change)

**Files:** none (verification only — updates `SERIES` in `backend/wastewise/adapters/price_fred.py` from Task 1 only if a mismatch is found)

Only `eggs` (`APU0000708111`) was confirmed live in the PR description ($2.19, May 2026). The other five entries are unverified, and a wrong-but-valid series ID fails *silently* — FRED will return a normal-looking price for the wrong commodity rather than an error, so nothing in the test suite would catch a typo here.

- [ ] **Step 1: Query each series' metadata against the live FRED API**

Run, substituting a real key for `$FRED_API_KEY` (get one free at https://fred.stlouisfed.org/docs/api/api_key.html if you don't already have one from the PR author):

```bash
for series in APU0000706111 APU0000708111 APU0000709112 APU0000712311 APU0000701322 APU0000715211; do
  echo "=== $series ==="
  curl -s "https://api.stlouisfed.org/fred/series?series_id=${series}&api_key=${FRED_API_KEY}&file_type=json" | python -c "import sys,json; print(json.load(sys.stdin)['seriess'][0]['title'])"
done
```

- [ ] **Step 2: Compare each returned title against the intended commodity**

Confirm the titles read as:
- `APU0000706111` → chicken (fresh, whole or breast — either is acceptable for "chicken")
- `APU0000708111` → eggs, grade A, large (already confirmed)
- `APU0000709112` → milk, fresh, whole
- `APU0000712311` → tomatoes, field grown
- `APU0000701322` → rice, white, long grain, precooked
- `APU0000715211` → sugar, white, all sizes

- [ ] **Step 3: If any title doesn't match, fix the `SERIES` map**

If a mismatch is found, look up the correct series ID at https://fred.stlouisfed.org (search "Average Price: <item>") and update the corresponding entry in `backend/wastewise/adapters/price_fred.py`'s `SERIES` dict. Re-run `cd backend && pytest -q` after any change.

- [ ] **Step 4: Commit only if a fix was needed**

```bash
git add backend/wastewise/adapters/price_fred.py
git commit -m "fix: correct FRED series id for <item>"
```

(Skip this step entirely if Steps 1–2 confirmed every ID is correct.)

---

### Task 9: Fix `docs/STATUS.md`'s self-contradicting USDA/MARS references

**Files:**
- Modify: `docs/STATUS.md`

`docs/STATUS.md` is a *new* file added by this same PR, describing "what's built" — but it still describes the price adapter as USDA/MARS-based, which is exactly the implementation this PR replaces. Since it's new, there's no excuse for it being stale; fix it to describe what actually shipped.

- [ ] **Step 1: Update the adapter bullet**

Change:

```
  - USDA wholesale prices via MARS API ([price_usda.py](../backend/wastewise/adapters/price_usda.py))
```

to:

```
  - US retail average prices via FRED/BLS series ([price_fred.py](../backend/wastewise/adapters/price_fred.py))
```

- [ ] **Step 2: Update the sourcing agent bullet**

Change:

```
  - Sourcing agent — writes one-liner comparing chosen price to USDA benchmark ([sourcing.py](../backend/wastewise/agents/sourcing.py))
```

to:

```
  - Sourcing agent — writes one-liner comparing chosen price to the FRED/BLS benchmark ([sourcing.py](../backend/wastewise/agents/sourcing.py))
```

- [ ] **Step 3: Update the "Multi-market adapters" non-goal line**

Change:

```
- Multi-market adapters beyond USDA/Kroger/NOAA/US holidays
```

to:

```
- Multi-market adapters beyond FRED/Kroger/NOAA/US holidays
```

- [ ] **Step 4: Update the environment configuration table**

Change:

```
| `USDA_API_KEY` | Sourcing savings figure | Savings always $0.00 |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | Real retail supplier prices | "Market" fallback with USDA-benchmark pricing |
```

to:

```
| `FRED_API_KEY` | Sourcing savings figure | Savings always $0.00 |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | Real retail supplier prices | "Market" fallback with FRED-benchmark pricing |
```

- [ ] **Step 5: Verify no USDA references remain in the file**

Run: `git grep -in "usda" -- docs/STATUS.md`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add docs/STATUS.md
git commit -m "docs: fix STATUS.md to describe the FRED adapter instead of the replaced USDA/MARS one"
```

---

### Task 10: Full verification and push to update PR #9

**Files:** none (verification and push only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && pytest -q`
Expected: all tests green (same count as before this branch, minus the renamed-not-lost `test_price_usda.py` → `test_price_fred.py`, plus 2 new tests from Tasks 2 and 4).

- [ ] **Step 2: Run the full frontend suite and typecheck**

Run: `cd frontend && npx vitest run`
Expected: all tests green (38 tests: the original 37 plus the new table-role assertion added in Task 7 to an existing test, so the count may show the same 37 "it" blocks with one more assertion — not a new count if you extended rather than added a test).

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Final sweep for any remaining USDA reference outside historical docs**

Run: `git grep -in "usda" -- . ':!docs/specs' ':!docs/plans' ':!docs/reviews'`
Expected: no output.

- [ ] **Step 4: Push to update the open PR**

```bash
git push origin HEAD:feat/fred-price-benchmark
```

Confirm PR #9 (`https://github.com/lostpay/wastewise/pull/9`) now shows the new commits and CI (if configured) passes.

- [ ] **Step 5: Leave a summary comment on the PR** (manual, via `gh pr comment 9`, only if you want a record of what changed and why — optional, not required to merge).
