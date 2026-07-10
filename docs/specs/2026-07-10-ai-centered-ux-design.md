# WasteWise — AI-Centered UX Design

Date: 2026-07-10
Status: Approved for implementation

## Problem

WasteWise's AI reasoning currently reads as decorative rather than central to
the product's value proposition, for five concrete reasons:

1. `agents/adjustment.py` sends every item in one LLM call and expects a JSON
   array back. In practice the model returns the same generic reason for
   every item (e.g. "Rain forecast lowers dine-in demand." on cabbage, pork,
   *and* chicken) instead of reasoning about why each item is differently
   weather/holiday-sensitive.
2. `agents/sourcing.py`'s `_choose_offer` already reasons well about
   trade-offs between retail candidates (plain vs. marinated, price vs.
   quality), but that reasoning is thrown away into a tiny note string with
   no visual weight.
3. `components/reason-badge.tsx` is `hidden sm:flex` on the forecast page —
   mobile users never see any AI reasoning at all — and at 11px it's easy to
   miss even on desktop.
4. There is no way for a user to tell whether they're looking at a live LLM
   response or a silent fallback. The frontend currently infers this by
   string-sniffing magic values (`reason === "No adjustment applied."`,
   `supplier === "Market"`), which is fragile and, in sourcing's case,
   actually blind to a real failure mode (see §3 below).
5. The Order page shows a table and an Approve button with no synthesis —
   no AI-generated reasoning ties the forecast adjustment and sourcing
   savings together into a purchasing rationale before approval.

This design fixes all five in one pass, reusing the parallel-call pattern
`sourcing.py` already proved out rather than inventing a new one.

## Context / constraint

Submission deadline is 2026-07-11 15:00 UTC (~24h out per `docs/STATUS.md`).
`STATUS.md` flags LLM-call reliability as the top submission risk: in
practice the adjustment call sometimes falls back silently and the fallback
is easy to mistake for a legitimate "no signal" response. This design
increases total LLM call count (adjustment moves from 1 call to N parallel
calls; a new single rationale call is added) but keeps wall-clock time flat
for this app's realistic item counts (the demo dataset has 3 items; any
call fits well under the existing `max_workers=8` cap), and — because each
item's fallback is now independently visible via the `live` field — actually
*shrinks* the blast radius of a single failed call instead of enlarging it.
Today, one bad JSON parse zeroes out reasoning for every item; after this
change, it zeroes out reasoning for one item, clearly labeled.

## 1. Backend — Adjustment agent (`backend/wastewise/agents/adjustment.py`)

Replace the single all-items call with one call per item, run concurrently:

```python
with ThreadPoolExecutor(max_workers=min(8, len(items)) or 1) as pool:
    results = list(pool.map(_adjust_one_partial, items))
```

mirroring `sourcing.py::source_order`'s existing `_resolve`/`ThreadPoolExecutor`
pattern exactly. Each call receives only that item's name and recommended
quantity, plus the shared weather/holiday context — the model can no longer
see other items, which structurally prevents copy-pasted reasoning across
items regardless of prompt wording.

Rewrite `SYSTEM` to include 2-3 few-shot examples demonstrating that the
*same* weather condition should produce *different* reasoning depending on
the item's category — e.g. rain increasing demand for a hot/comfort item
(stew, hot pot) while decreasing demand for a cold/perishable item (salad
greens), and a holiday increasing demand for a bulk/gathering item. This
gives the model a concrete differentiation pattern instead of asking it to
infer one from a bare instruction.

`AdjustedItem` gains `live: bool` — `True` only when that item's call
returned parseable JSON with a valid `adjusted_qty`/`reason`; `False` on any
exception path (timeout, malformed JSON, missing keys). The per-item
fallback reason text changes from "No adjustment applied." to something
that doesn't imply the LLM deliberately found no signal — e.g. "AI
reasoning unavailable — using base forecast." — since `live` now carries
that distinction explicitly and the reason string shouldn't blur it.

## 2. Backend — Sourcing agent (`backend/wastewise/agents/sourcing.py`)

`POLine` gains `live: bool`, threaded through from `_choose_offer`'s
existing try/except: `True` on the LLM-selection success path, `False` on
the `fallback_best` path. No prompt changes — item 2 above is a UI
surfacing gap, not a reasoning-quality gap. `SupplierCell`'s "No live
offer"/"Market" concept (no retail candidates existed at all) stays
orthogonal to `live` (whether the *choice among* existing candidates was
LLM-reasoned or heuristic) — a real Kroger listing can still be picked via
the cheapest-price fallback if its selection call failed, and today that's
invisible.

## 3. Backend — New Rationale agent + endpoint

New `backend/wastewise/agents/rationale.py`, one LLM call (not per-item)
that takes the forecast's adjusted items (item, reason, delta) and the
sourcing lines (item, supplier, note, savings) and writes one paragraph
connecting the weather/holiday adjustment story to the sourcing trade-off
story into a coherent purchasing rationale. Deterministic fallback if the
call fails: a templated sentence assembled from numbers already on hand
(e.g. "N items were adjusted for weather and holiday signals; sourcing
across M suppliers saves $X versus benchmark pricing.").

New model:

```python
class RationaleResponse(BaseModel):
    paragraph: str
    live: bool
```

New endpoint `POST /rationale`, request body carrying the forecast's
`items` and the sourcing's `lines` (plus `savings`/`total` for the fallback
template), wired through a new `pipeline.run_rationale(items, lines,
savings, total, llm) -> RationaleResponse`.

## 4. Frontend — types & API client

`ForecastAdjustedItem` and `POLine` (`lib/types.ts`) gain `live: boolean`.
New `RationaleResponse` type. New `runRationale()` in `lib/api.ts`,
following the existing `call()` helper's demo-mode/5xx-fallback pattern
used by `runForecast`/`runSourcing`.

`lib/demo.ts`'s canned forecast data currently reproduces the exact bug
from §1 verbatim (cabbage/pork/chicken all get "Rain forecast lowers
dine-in demand.") — fix it to have genuinely different per-item reasons,
add a canned rationale paragraph, and mark all canned data `live: true`
(demo mode is meant to look like the real product working, not a degraded
state).

## 5. Frontend — `ReasonBadge` (items 3 + 4)

Branches on `live` instead of string-matching `NO_ADJUSTMENT`:
- `live: true` → today's accent-bordered "AI" badge, bumped from 11px to a
  clearly-readable size with heavier weight.
- `live: false` → a visually distinct muted/dashed state (not just a
  fainter version of the same badge) reading e.g. "AI unavailable."

Mobile fix: desktop/tablet (`sm:` and up) keeps the current single-row
5-column layout, just louder. Below `sm`, a second full-width row renders
directly under each item's row containing only the badge — so it's always
visible and never crammed into the base row's numeric columns.

## 6. Frontend — `PriceTable` note column (item 2)

Kept independently styled (not merged into `ReasonBadge`) but made louder:
when `line.live` is true, the note renders with an explicit "AI picked
this" framing (small accent label + the LLM's actual trade-off reasoning);
when false, it keeps today's plain muted formulaic note. `SupplierCell`'s
existing "No live offer" logic is unchanged.

## 7. Frontend — Order page (item 5)

New rationale card between the page header and the PO table, fetched on
mount the same way Forecast fetches its forecast (skeleton while loading,
cached in wizard store after). A small live/fallback indicator sits next
to the paragraph, same visual language as items 3/4. Approve and Download
are never gated on the rationale call — consistent with the rest of the
app never blocking navigation on an LLM round trip, and avoiding a stuck
button if that call is slow or falls back.

`lib/store.tsx`'s `WizardState` gains `rationale: RationaleResponse | null`
plus a setter, following the existing `forecast`/`sourcing` pattern
(sessionStorage-persisted, reset on Setup mount).

## 8. Testing

Backend: rewrite `test_adjustment.py` for the parallel-per-item
architecture (mock LLM returning different responses per call to assert
real differentiation, not just structural coverage) and the `live` field;
extend `test_sourcing.py` for `live`; new `test_rationale.py` covering both
the live and deterministic-fallback paths.

Frontend: update `forecast.test.tsx`, `sourcing.test.tsx`, `order.test.tsx`
for the new fields and components; add/extend a `reason-badge` test for
the `live`-branching behavior.

Given the deadline risk noted above, the implementation plan should call
out smoke-testing the adjustment and rationale call paths against the real
vLLM endpoint early — not just against a mocked LLM in unit tests — so any
new timeout/reliability issue surfaces with time to fix it, not during demo
recording.

## Out of scope

- Any change to the forecasting model itself (XGBoost pipeline, safety
  buffer, baseline comparison).
- Any change to data adapters (weather, holidays, FRED, Kroger).
- Unifying `ReasonBadge` and `PriceTable`'s note styling into one shared
  component (considered, explicitly declined — kept independently styled).
- Gating Approve on the rationale paragraph loading (considered, explicitly
  declined).
