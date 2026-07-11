# AI Agency Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the LLM from a caption-writer into a visible decision-maker: honest AI deltas (stop displaying the safety buffer as AI work), capped anomaly-only weather adjustments, sourcing verdicts that can flag overpriced listings, spoilage-aware safety buffers (the "waste" in WasteWise), a conversational what-if agent on the order page, and LLM column-mapping for messy CSVs.

**Architecture:** No new services. Backend keeps the existing agent pattern (one module per agent in `backend/wastewise/agents/`, deterministic fallback + `live` flag on every LLM path). New Pydantic fields all get safe defaults so old sessionStorage state and `frontend/lib/demo.ts` fixtures keep working without edits. Frontend keeps the wizard-store pattern; all new response fields are optional in `types.ts`.

**Tech Stack:** Python/FastAPI + pytest (backend, run from `backend/`), Next.js 16/TypeScript (frontend, run from `frontend/`; verify with `npx tsc --noEmit` and `npm test`).

## Global Constraints

- **Every new LLM call must have a deterministic fallback and a `live` flag** — same pattern as `adjustment.py` / `sourcing.py`. A dead endpoint must never 500 or silently pretend to be AI.
- **New Pydantic/TS fields must have defaults** (`= 0.0`, `= False`, `?:`) so existing tests, demo fixtures, and persisted wizard state deserialize unchanged.
- **Spoilage fallback must preserve current behavior**: when the spoilage agent can't answer, the buffer stays at the current 15% (`risk="low"`), so existing integration tests that assert exact quantities stay green.
- Kroger `unit_price` is per *package* while the BLS benchmark is per *unit*; the app already compares them directly (see `price-table.tsx` "% vs. avg"). Stay consistent — unit normalization is **out of scope**.
- Out of scope (separate future plan): streaming/SSE agent progress on the forecast page.
- Backend gate before every commit: `pytest -q` from `backend/` — all green. Frontend gate: `npx tsc --noEmit` (no output) and `npm test` from `frontend/`.
- The frontend is Next.js 16 — read `frontend/node_modules/next/dist/docs/` before non-trivial frontend changes (per `frontend/AGENTS.md`).

---

### Task 1: Carry `recommended` through the adjustment agent and cap the LLM at ±25%

The forecast page currently shows Δ = `adjusted_qty − forecast`, which includes the 15% safety buffer — so the UI displays the buffer as "AI adjustment" and every row looks like the AI bumped it +15–29%. Fix the data first: `AdjustedItem` must carry the buffered recommendation so the UI can show the AI's *true* delta. While here, make the prompt anomaly-only ("unremarkable weather ⇒ no change") and clamp the model's output to ±25% of the recommendation so a hallucinated number can never wreck an order.

**Files:**
- Modify: `backend/wastewise/models.py` (AdjustedItem)
- Modify: `backend/wastewise/agents/adjustment.py`
- Test: `backend/tests/test_adjustment.py`

**Interfaces:**
- Produces: `AdjustedItem.recommended: float` (the pre-LLM `recommended_purchase_qty`; default `0.0`). Task 2's `summarize_adjustments` and Task 3's frontend rely on it.
- Produces: `MAX_ADJUST_FRAC = 0.25` module constant in `adjustment.py`.
- `adjust_forecast(items, weather, holidays, llm)` signature unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_adjustment.py`:

```python
class _ExtremeHighLLM:
    def complete(self, system, user):
        return '{"adjusted_qty": 9999, "reason": "Heat wave megaorder."}'


class _ExtremeLowLLM:
    def complete(self, system, user):
        return '{"adjusted_qty": 1, "reason": "Nobody eats this week."}'


def test_llm_adjustment_is_clamped_to_25_percent_up():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Heat", temp_c=38,
                          precipitation_mm=0)), [], _ExtremeHighLLM())
    by_item = {o.item: o for o in out}
    # stew: recommended 115 -> ceiling 115 * 1.25 = 143.75
    assert by_item["stew"].adjusted_qty == 143.75
    assert by_item["stew"].live is True


def test_llm_adjustment_is_clamped_to_25_percent_down():
    out = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Storm", temp_c=10,
                          precipitation_mm=30)), [], _ExtremeLowLLM())
    by_item = {o.item: o for o in out}
    # salad greens: recommended 90 -> floor 90 * 0.75 = 67.5
    assert by_item["salad greens"].adjusted_qty == 67.5


def test_recommended_qty_is_carried_through_on_success_and_fallback():
    ok = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Rain", temp_c=15,
                         precipitation_mm=8)), [], _PerItemLLM())
    assert {o.item: o.recommended for o in ok} == {"stew": 115, "salad greens": 90}
    bad = adjust_forecast(_items(), _one_day(WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0)), [], _BadJsonLLM())
    assert {o.item: o.recommended for o in bad} == {"stew": 115, "salad greens": 90}
```

Also update the existing `_PerItemLLM` fixture: its `salad greens` response of `60` would now clamp (floor 67.5) and muddy the "different reasoning" test. Change that response's quantity to `70` and the corresponding assertion:

```python
# in _PerItemLLM._RESPONSES
"salad greens": '{"adjusted_qty": 70, "reason": "Rain lowers dine-in demand for cold salad items."}',
```
```python
# in test_adjusts_each_item_with_genuinely_different_reasoning
assert by_item["salad greens"].adjusted_qty == 70
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run from `backend/`: `pytest tests/test_adjustment.py -v`
Expected: the three new tests FAIL (`recommended` doesn't exist / no clamping); the updated existing test passes only after Step 3.

- [ ] **Step 3: Implement**

In `backend/wastewise/models.py`, add to `AdjustedItem`:

```python
class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str
    live: bool
    daily: list[float] = []
    # Pre-LLM buffered recommendation (forecast + safety buffer). Lets the UI
    # show the AI's true delta instead of blaming the buffer on the AI.
    recommended: float = 0.0
```

In `backend/wastewise/agents/adjustment.py`, replace `SYSTEM` and `_adjust_one`:

```python
MAX_ADJUST_FRAC = 0.25

SYSTEM = (
    "You are a restaurant purchasing assistant. You are given ONE item's "
    "recommended purchase quantity (which already includes a safety buffer) "
    "plus the day-by-day weather for the purchasing horizon and its holidays. "
    "Decide whether the weather pattern or a holiday is a clear, UNUSUAL "
    "demand signal for THIS item's category. Mild or seasonal weather is NOT "
    "a signal: in that case return the quantity UNCHANGED and say why no "
    "adjustment is needed. Adjust only for pronounced signals (sustained "
    "rain, a heat wave, a cold snap, a holiday), never by more than 25% in "
    "either direction, and give a one-sentence item-specific reason. The "
    "same weather affects different item categories differently -- never "
    "reuse a generic reason across items.\n\n"
    "Examples of the differentiation expected:\n"
    "- Rain all week, item 'beef stew' (hot/comfort food): demand goes UP -> "
    '{"adjusted_qty": 115, "reason": "Sustained rain drives comfort-food '
    'orders like stew up."}\n'
    "- Rain all week, item 'mixed salad greens' (cold/perishable): demand "
    'goes DOWN as dine-in traffic drops -> {"adjusted_qty": 80, "reason": '
    '"Rain lowers dine-in demand for cold salad items."}\n'
    "- Holiday (e.g. Thanksgiving), item 'turkey' (bulk/gathering item): "
    'demand goes UP -> {"adjusted_qty": 120, "reason": "Thanksgiving drives '
    'bulk turkey purchases for gatherings."}\n'
    "- Mild 22C, partly cloudy week, item 'rice' (shelf-stable staple): no "
    'clear signal -> {"adjusted_qty": 100, "reason": "Unremarkable weather '
    'for the season; no adjustment needed for a shelf-stable staple."}\n\n'
    'Respond ONLY with JSON: {"adjusted_qty": number, "reason": str}. '
    "Reply in English."
)
```

```python
def _adjust_one(item: ForecastItem, weather_txt: str, holiday_txt: str, llm) -> AdjustedItem:
    rec = item.recommended_purchase_qty
    user = (f"Weather: {weather_txt}. Holidays: {holiday_txt}.\n"
            f"Item: {item.item}, recommended quantity: {rec}.")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        adjusted_qty = float(parsed["adjusted_qty"])
        reason = str(parsed["reason"]).strip()
        if not reason:
            raise ValueError("empty reason")
        # Hard cap: a hallucinated number must never move an order more than
        # +/-25% away from the buffered recommendation.
        lo, hi = rec * (1 - MAX_ADJUST_FRAC), rec * (1 + MAX_ADJUST_FRAC)
        adjusted_qty = round(min(max(adjusted_qty, lo), hi), 2)
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=adjusted_qty, reason=reason, live=True,
                            daily=item.daily, recommended=rec)
    except Exception as e:
        print(f"[adjustment] LLM call failed for {item.item!r}: "
              f"{type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=rec,
                            reason=FALLBACK_REASON, live=False, daily=item.daily,
                            recommended=rec)
```

- [ ] **Step 4: Run the full backend suite**

Run from `backend/`: `pytest -q`
Expected: all pass (the `130` stew expectation still fits inside the 143.75 cap).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/agents/adjustment.py backend/tests/test_adjustment.py
git commit -m "feat: cap weather adjustment at ±25% and carry recommended qty through"
```

---

### Task 2: Adjustment audit summary on the forecast response

Aggregate what the AI actually did (raised / lowered / left unchanged, net %) so the UI can prove the adjustment isn't a uniform bias.

**Files:**
- Modify: `backend/wastewise/models.py` (new `AdjustmentSummary`, field on `ForecastResponse`)
- Modify: `backend/wastewise/agents/adjustment.py` (new `summarize_adjustments`)
- Modify: `backend/wastewise/pipeline.py`
- Test: `backend/tests/test_adjustment.py`

**Interfaces:**
- Consumes: `AdjustedItem.recommended` (Task 1).
- Produces: `AdjustmentSummary(n_up: int, n_down: int, n_unchanged: int, net_delta_pct: float)`; `ForecastResponse.adjustment: AdjustmentSummary | None = None`; `summarize_adjustments(adjusted: list[AdjustedItem]) -> AdjustmentSummary`. Task 3's frontend reads `forecast.adjustment`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_adjustment.py`:

```python
from wastewise.agents.adjustment import summarize_adjustments
from wastewise.models import AdjustedItem


def test_summarize_adjustments_counts_directions_and_net_pct():
    adjusted = [
        AdjustedItem(item="a", forecast=90, adjusted_qty=110, reason="r", live=True, recommended=100),
        AdjustedItem(item="b", forecast=90, adjusted_qty=90, reason="r", live=True, recommended=100),
        AdjustedItem(item="c", forecast=90, adjusted_qty=100, reason="r", live=True, recommended=100),
    ]
    s = summarize_adjustments(adjusted)
    assert (s.n_up, s.n_down, s.n_unchanged) == (1, 1, 1)
    # (110 + 90 + 100) - 300 = 0 -> 0.0%
    assert s.net_delta_pct == 0.0


def test_summarize_adjustments_handles_zero_recommended():
    s = summarize_adjustments([AdjustedItem(item="a", forecast=0, adjusted_qty=0,
                                            reason="r", live=False, recommended=0)])
    assert s.net_delta_pct == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_adjustment.py -v`
Expected: FAIL with `ImportError: cannot import name 'summarize_adjustments'`.

- [ ] **Step 3: Implement**

In `backend/wastewise/models.py`, add above `ForecastResponse` and extend it:

```python
class AdjustmentSummary(BaseModel):
    n_up: int
    n_down: int
    n_unchanged: int
    net_delta_pct: float


class ForecastResponse(BaseModel):
    items: list[AdjustedItem]
    baseline_delta: float
    waste_avoided_units: float = 0.0
    waste_avoided_value: float | None = None
    adjustment: AdjustmentSummary | None = None
```

In `backend/wastewise/agents/adjustment.py` (import `AdjustmentSummary` from `wastewise.models`):

```python
def summarize_adjustments(adjusted: list[AdjustedItem]) -> AdjustmentSummary:
    n_up = sum(1 for a in adjusted if a.adjusted_qty > a.recommended)
    n_down = sum(1 for a in adjusted if a.adjusted_qty < a.recommended)
    rec_sum = sum(a.recommended for a in adjusted)
    net = 0.0 if rec_sum == 0 else \
        (sum(a.adjusted_qty for a in adjusted) - rec_sum) / rec_sum * 100
    return AdjustmentSummary(n_up=n_up, n_down=n_down,
                             n_unchanged=len(adjusted) - n_up - n_down,
                             net_delta_pct=round(net, 1))
```

In `backend/wastewise/pipeline.py`, import it and set it on the response:

```python
from wastewise.agents.adjustment import adjust_forecast, summarize_adjustments
...
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    return ForecastResponse(items=adjusted, baseline_delta=stats.delta,
                            waste_avoided_units=stats.waste_avoided_units,
                            waste_avoided_value=stats.waste_avoided_value,
                            adjustment=summarize_adjustments(adjusted))
```

- [ ] **Step 4: Run the full backend suite**

Run: `pytest -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/agents/adjustment.py backend/wastewise/pipeline.py backend/tests/test_adjustment.py
git commit -m "feat: report adjustment audit summary on forecast response"
```

---

### Task 3: Honest forecast table — Δ vs. recommendation, audit tile, truthful captions

Frontend half of Tasks 1–2. The Δ column compares against the buffered recommendation, a new tile shows the audit summary, and the accuracy tile stops implying the LLM was part of the backtest.

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/app/forecast/page.tsx`

**Interfaces:**
- Consumes: `recommended` on items and `adjustment` on the response (Tasks 1–2). Both optional in TS so `lib/demo.ts` fixtures (which lack them) still render — always fall back with `it.recommended ?? it.forecast`.

- [ ] **Step 1: Extend the types**

In `frontend/lib/types.ts`:

```ts
export interface ForecastAdjustedItem {
  item: string;
  forecast: number;
  adjusted_qty: number;
  reason: string;
  live: boolean;
  daily?: number[];
  // Buffered recommendation before the AI adjustment. Optional: demo
  // fixtures and old persisted sessions don't have it — fall back to forecast.
  recommended?: number;
}

export interface AdjustmentSummary {
  n_up: number;
  n_down: number;
  n_unchanged: number;
  net_delta_pct: number;
}
```

and add to `ForecastResponse`:

```ts
export interface ForecastResponse {
  items: ForecastAdjustedItem[];
  baseline_delta: number;
  waste_avoided_units?: number;
  waste_avoided_value?: number | null;
  adjustment?: AdjustmentSummary | null;
}
```

- [ ] **Step 2: Rework the forecast page**

In `frontend/app/forecast/page.tsx`:

a) Intro copy — replace the paragraph body (currently "Per-item demand for the {rangeLabel}. The base model predicts sales from your history; an LLM then nudges each quantity up or down for weather and public holidays.") with:

```tsx
          Per-item demand for the {rangeLabel}. The base model predicts sales
          from your history and adds a safety buffer; an AI agent then adjusts
          only when weather or holidays warrant it, capped at ±25%.
```

b) Accuracy tile — change label/hint so the metric is honest about what it measures:

```tsx
            <StatTile
              label="Base-model accuracy gain vs. simple seasonal baseline"
              value={`${Math.round(forecast.baseline_delta * 100)}%`}
              hint="Lower mean absolute error on a 7-day holdout vs. a naive same-weekday baseline. Measured on the base model, before the AI weather adjustment. Higher is better."
            />
```

c) Audit tile — inside the same grid, after the over-ordering tile, add:

```tsx
            {forecast.adjustment ? (
              <StatTile
                label="AI weather adjustment (net)"
                value={`${forecast.adjustment.net_delta_pct >= 0 ? "+" : ""}${forecast.adjustment.net_delta_pct.toFixed(1)}%`}
                hint={`${forecast.adjustment.n_up} raised, ${forecast.adjustment.n_down} lowered, ${forecast.adjustment.n_unchanged} unchanged vs. the buffered recommendation. Each item is capped at ±25%.`}
              />
            ) : null}
```

and widen the grid wrapper to fit three tiles: `className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"`.

d) Table — give the buffer its own column and compute Δ against the recommendation. Header row becomes:

```tsx
                    <th className="ww-label px-4 py-2 text-left">Item</th>
                    <th className="ww-label px-4 py-2 text-right">Model</th>
                    <th className="ww-label px-4 py-2 text-right">+ Buffer</th>
                    <th className="ww-label px-4 py-2 text-right">AI adj.</th>
                    <th className="ww-label px-4 py-2 text-right">Δ</th>
                    <th className="ww-label hidden px-4 py-2 text-right sm:table-cell">Note</th>
```

In the row map, replace the delta computation with:

```tsx
                    const rec = it.recommended ?? it.forecast;
                    const delta = it.adjusted_qty - rec;
                    const deltaPct = rec ? (delta / rec) * 100 : 0;
```

and render the cells as Model = `it.forecast.toFixed(1)`, + Buffer = `rec.toFixed(1)` (muted), AI adj. = `it.adjusted_qty.toFixed(1)` (semibold), Δ unchanged in style. Update the mobile fallback row's `colSpan` from `4` to `5`.

- [ ] **Step 3: Verify**

Run from `frontend/`: `npx tsc --noEmit` (expected: no output) and `npm test` (expected: all pass).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/app/forecast/page.tsx
git commit -m "feat: show true AI delta vs buffered recommendation with audit tile"
```

---

### Task 4: Benchmark-aware sourcing — the AI can flag "don't buy this here"

Today the agent cheerily justifies Kroger chicken at +145% over the US average and the page still claims "savings". Give the selection agent a verdict, add a deterministic overprice guard on top, and report a `flagged` bit per line plus an `overpay` total.

**Files:**
- Modify: `backend/wastewise/models.py` (`POLine.flagged`, `SourcingResponse.overpay`)
- Modify: `backend/wastewise/agents/sourcing.py`
- Test: `backend/tests/test_sourcing.py`

**Interfaces:**
- Produces: `POLine.flagged: bool = False`; `SourcingResponse.overpay: float = 0.0`; module constant `FLAG_FRAC = 1.25` in `sourcing.py`. Task 5's frontend reads both fields.
- `_choose_offer` now returns a 4-tuple `(offer, note, live, caution)`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sourcing.py`:

```python
def test_overpriced_pick_is_flagged_and_overpay_totalled():
    # _SelectingLLM picks index 1 at 4.5; benchmark 2.0 -> 4.5 > 1.25 * 2.0,
    # so the deterministic guard flags it even though the LLM said nothing.
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _SelectingLLM(), "loc")
    assert resp.lines[0].flagged is True
    assert resp.overpay == 5.0  # (4.5 - 2.0) * 2


class _CautionLLM:
    def complete(self, system, user):
        return json.dumps({"index": 1, "reason": "All candidates run well above the US average.",
                           "verdict": "caution"})


def test_llm_caution_verdict_flags_the_line():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _CautionLLM(), "loc")
    assert resp.lines[0].flagged is True
    assert resp.lines[0].note == "All candidates run well above the US average."


def test_cheap_pick_is_not_flagged_and_overpay_zero():
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc")
    assert resp.lines[0].flagged is False
    assert resp.overpay == 0.0


def test_historical_benchmark_does_not_drive_the_price_guard():
    # Historical items get real_benchmark None -> guard can't fire on them.
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _Wholesale(), _Retail(), _FakeLLM(), "loc",
                        historical_items={"cabbage"})
    assert resp.lines[0].flagged is False
    assert resp.overpay == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_sourcing.py -v`
Expected: the four new tests FAIL (`flagged` / `overpay` don't exist).

- [ ] **Step 3: Implement**

`backend/wastewise/models.py`:

```python
class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str
    live: bool
    benchmark: float | None = None
    unit: str = ""
    # True when the AI (or the deterministic price guard) says this price is
    # bad enough that the buyer should trim, substitute, or shop elsewhere.
    flagged: bool = False


class SourcingResponse(BaseModel):
    lines: list[POLine]
    total: float
    savings: float
    # Sum of (unit_price - US benchmark) * qty over lines priced above their
    # real benchmark -- the honest counterweight to `savings`.
    overpay: float = 0.0
```

`backend/wastewise/agents/sourcing.py` — replace `SELECT_SYSTEM`, `_choose_offer`, and the tail of `source_order`:

```python
FLAG_FRAC = 1.25  # price > 1.25x the US benchmark -> flag regardless of the LLM

SELECT_SYSTEM = (
    "You are a restaurant purchasing agent choosing which supplier listing to buy "
    "for a bulk kitchen order. Given a plain ingredient name, a US retail average "
    "benchmark price (BLS, via FRED) (or 'none' if unavailable), and a numbered "
    "list of candidate retail listings (each with a description and unit price), "
    "pick the listing that is the plain, unprocessed commodity form of the "
    "ingredient -- not a marinated, seasoned, or specialty product -- at the best "
    "price. Also give a verdict: \"buy\" when the price is reasonable, \"caution\" "
    "when even the best candidate is far above the US benchmark or clearly "
    "overpriced -- and when the verdict is \"caution\", the reason must warn the "
    "buyer about the price (suggest trimming or substituting), never justify it. "
    'Respond ONLY with JSON: {"index": int, "reason": str, "verdict": "buy"|"caution"}. '
    '"index" is the 0-based position in the candidate list. "reason" is one short '
    "English sentence. If the benchmark is 'none', do NOT claim or imply a "
    "comparison to it -- explain the choice in terms of the listing itself instead."
)
```

```python
def _choose_offer(llm, item: str, offers: list[SupplierPrice],
                  benchmark: float | None) -> tuple[SupplierPrice, str, bool, bool]:
    """Returns (offer, note, live, caution). `caution` is the LLM's own
    verdict; the deterministic price guard is applied later where the *real*
    benchmark is known."""
    fallback_best = min(offers, key=lambda o: o.unit_price)
    candidates = "\n".join(
        f"[{i}] {o.description or o.supplier} @ {o.unit_price}"
        for i, o in enumerate(offers))
    bench_txt = "none" if benchmark is None else str(benchmark)
    try:
        raw = llm.complete(
            SELECT_SYSTEM,
            f"Item: {item}. Benchmark: {bench_txt}. Candidates:\n{candidates}")
        parsed = extract_json(raw)
        idx = int(parsed["index"])
        reason = str(parsed["reason"]).strip()
        caution = str(parsed.get("verdict", "buy")).strip().lower() == "caution"
        if not (0 <= idx < len(offers)) or not reason:
            raise ValueError("bad selection")
        return offers[idx], reason, True, caution
    except Exception as e:
        print(f"[sourcing] LLM call failed for {item!r}: "
              f"{type(e).__name__}: {e}", file=sys.stderr, flush=True)
        return fallback_best, _fallback_note(fallback_best.unit_price, benchmark), False, False
```

In `source_order`, `_resolve`'s non-offer branches return 4-tuples ending in `False`:

```python
    def _resolve(p):
        item, qty, benchmark, offers = p
        if offers:
            return _choose_offer(llm, item, offers, benchmark)
        if benchmark is not None:
            return None, _fallback_note(benchmark, benchmark), False, False
        return None, NO_MATCH_NOTE, False, False
```

and the accumulation loop gains the guard + overpay:

```python
    total = 0.0
    savings = 0.0
    overpay = 0.0
    lines = []
    for (item, qty, benchmark, offers), (offer, note, live, caution) in zip(prepared, resolved):
        ...  # existing supplier/unit_price/real_benchmark/note logic unchanged
        flagged = caution or (
            real_benchmark is not None and unit_price > FLAG_FRAC * real_benchmark)
        if real_benchmark is not None and unit_price > real_benchmark:
            overpay += (unit_price - real_benchmark) * qty
        if (real_benchmark is not None
                and unit_price < real_benchmark):
            savings += (real_benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=note, live=live, benchmark=real_benchmark,
                            unit=unit, flagged=flagged))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2), overpay=round(overpay, 2))
```

(The `...` above means: keep the existing body between the `for` header and the flag computation exactly as it is today — supplier resolution, `line_total`, `real_benchmark`, historical note rewrite.)

- [ ] **Step 4: Run the full backend suite**

Run: `pytest -q` — all pass (existing sourcing tests don't assert `flagged`/`overpay`, and defaults keep other suites green).

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "feat: sourcing agent can flag overpriced listings; report overpay total"
```

---

### Task 5: Flagged-price UI, overpay tile, whole-unit order quantities

Frontend half of Task 4, plus two credibility fixes: the PO shows fractional quantities (the "29,34" sugar box), so round order quantities up to whole units at the forecast→sourcing handoff.

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/components/price-table.tsx`
- Modify: `frontend/app/sourcing/page.tsx`

**Interfaces:**
- Consumes: `POLine.flagged`, `SourcingResponse.overpay` (Task 4). Optional in TS (`flagged?: boolean`, `overpay?: number`) so demo fixtures still typecheck.

- [ ] **Step 1: Types**

In `frontend/lib/types.ts` add to `POLine`: `flagged?: boolean;` and to `SourcingResponse`: `overpay?: number;`.

- [ ] **Step 2: Flag treatment in the price table**

In `frontend/components/price-table.tsx`, replace `NoteCell`:

```tsx
function NoteCell({ line }: { line: POLine }) {
  const text = noteText(line);
  if (line.flagged) {
    return (
      <div className="flex flex-col gap-0.5 text-left">
        <span className="ww-label text-amber-700">AI flags this price</span>
        <span className="text-[11px] leading-snug text-foreground">{text}</span>
      </div>
    );
  }
  if (line.live) {
    return (
      <div className="flex flex-col gap-0.5 text-left">
        <span className="ww-label text-accent">AI picked this</span>
        <span className="text-[11px] leading-snug text-foreground">{text}</span>
      </div>
    );
  }
  return <span className="text-[11px] text-muted-foreground">{text}</span>;
}
```

and in `PriceCell`, make the over-benchmark delta amber when flagged — change the delta `<span>` class expression to:

```tsx
          className={`ww-num text-[10px] ${
            isUnder ? "text-emerald-700" : line.flagged ? "text-amber-700" : "text-muted-foreground"
          }`}
```

- [ ] **Step 3: Overpay tile + whole-unit quantities on the sourcing page**

In `frontend/app/sourcing/page.tsx`:

a) Handoff (line ~31) — order whole units:

```tsx
    const items = forecast.items.map((it) => ({ item: it.item, qty: Math.ceil(it.adjusted_qty) }));
```

b) Wrap the savings tile in a two-column grid and add the overpay tile:

```tsx
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Estimated savings vs. US retail average"
              value={`$${sourcing.savings.toFixed(2)}`}
              hint="Sum of (BLS benchmark − Kroger price) × qty for items where Kroger beats the benchmark. Items without a real US benchmark (e.g. Paneer, Mutton) are shown but not counted here."
            />
            {(sourcing.overpay ?? 0) > 0 ? (
              <StatTile
                label="AI-flagged overpayment vs. US retail average"
                value={`$${(sourcing.overpay ?? 0).toFixed(2)}`}
                hint="Sum of (Kroger price − BLS benchmark) × qty for items priced above the benchmark. The AI recommends trimming or substituting flagged lines rather than buying at these prices."
              />
            ) : null}
          </div>
```

- [ ] **Step 4: Verify**

Run from `frontend/`: `npx tsc --noEmit` (no output) and `npm test` (all pass).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/components/price-table.tsx frontend/app/sourcing/page.tsx
git commit -m "feat: surface AI price flags and overpay; order whole units"
```

---

### Task 6: Spoilage agent — risk-based safety buffers

The "waste" in WasteWise. One LLM call classifies every item's shelf life and spoilage risk (world knowledge no API provides); the risk sets the safety buffer per item (high 5%, medium 10%, low 15%) instead of a flat 15%. Fallback keeps today's 15% so nothing regresses when the LLM is down.

**Files:**
- Create: `backend/wastewise/agents/spoilage.py`
- Modify: `backend/wastewise/models.py` (`SpoilageInfo`; `AdjustedItem.spoilage_risk`, `.shelf_life_days`)
- Modify: `backend/wastewise/forecasting/forecaster.py` (`buffer_fracs` param)
- Modify: `backend/wastewise/pipeline.py` (wire it)
- Test: `backend/tests/test_spoilage.py` (new), `backend/tests/test_forecaster.py` (one addition)

**Interfaces:**
- Produces: `SpoilageInfo(risk: str, shelf_life_days: int | None, live: bool)` in `models.py`; `assess_spoilage(items: list[str], llm) -> dict[str, SpoilageInfo]` and `BUFFER_BY_RISK = {"high": 0.05, "medium": 0.10, "low": 0.15}` in `agents/spoilage.py`.
- Produces: `forecast_items(records, horizon_days, safety_frac=0.15, holiday_dates=frozenset(), buffer_fracs=None)` — `buffer_fracs: dict[str, float] | None`, per-item override of `safety_frac`.
- Produces: `AdjustedItem.spoilage_risk: str = ""` and `AdjustedItem.shelf_life_days: int | None = None`. Task 7's frontend reads them.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_spoilage.py`:

```python
# tests/test_spoilage.py
import json

from wastewise.agents.spoilage import assess_spoilage, BUFFER_BY_RISK


class _GoodLLM:
    def complete(self, system, user):
        return json.dumps([
            {"item": "rohu fish", "shelf_life_days": 2, "risk": "high"},
            {"item": "rice", "shelf_life_days": 365, "risk": "low"},
        ])


def test_assess_spoilage_parses_llm_reply():
    out = assess_spoilage(["rohu fish", "rice"], _GoodLLM())
    assert out["rohu fish"].risk == "high"
    assert out["rohu fish"].shelf_life_days == 2
    assert out["rohu fish"].live is True
    assert out["rice"].risk == "low"


def test_items_missing_from_reply_get_conservative_default():
    out = assess_spoilage(["rohu fish", "rice", "paneer"], _GoodLLM())
    # Default preserves the pre-spoilage 15% buffer (risk "low") and is
    # marked not-live so the UI won't render a made-up shelf life.
    assert out["paneer"].risk == "low"
    assert out["paneer"].shelf_life_days is None
    assert out["paneer"].live is False


class _BadLLM:
    def complete(self, system, user):
        return "not json"


def test_fallback_keeps_current_buffer_behavior():
    out = assess_spoilage(["rice"], _BadLLM())
    assert out["rice"].risk == "low"
    assert out["rice"].live is False
    assert BUFFER_BY_RISK[out["rice"].risk] == 0.15


class _InvalidRiskLLM:
    def complete(self, system, user):
        return json.dumps([{"item": "rice", "shelf_life_days": 5, "risk": "extreme"}])


def test_invalid_risk_value_falls_back_to_default():
    out = assess_spoilage(["rice"], _InvalidRiskLLM())
    assert out["rice"].risk == "low"
    assert out["rice"].live is False
```

Append to `backend/tests/test_forecaster.py`:

```python
def test_buffer_fracs_override_flat_safety_buffer():
    import datetime
    from wastewise.models import SalesRecord
    from wastewise.forecasting.forecaster import forecast_items
    records = [SalesRecord(date=datetime.date(2026, 1, 1) + datetime.timedelta(days=i),
                           item="rice", quantity=10 + (i % 3))
               for i in range(60)]
    items, _ = forecast_items(records, 7, buffer_fracs={"rice": 0.05})
    it = items[0]
    assert abs(it.safety_buffer - 0.05 * it.forecast) < 0.05
    # forecast/buffer are rounded independently, so allow a cent of drift.
    assert abs(it.recommended_purchase_qty - (it.forecast + it.safety_buffer)) < 0.05
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_spoilage.py tests/test_forecaster.py -v`
Expected: FAIL — `No module named 'wastewise.agents.spoilage'` and `TypeError: forecast_items() got an unexpected keyword argument 'buffer_fracs'`.

- [ ] **Step 3: Implement**

`backend/wastewise/models.py` — add near `WeatherInfo`, and extend `AdjustedItem`:

```python
class SpoilageInfo(BaseModel):
    risk: str                       # "high" | "medium" | "low"
    shelf_life_days: int | None
    live: bool
```

```python
class AdjustedItem(BaseModel):
    ...  # existing fields from Task 1 unchanged
    spoilage_risk: str = ""
    shelf_life_days: int | None = None
```

Create `backend/wastewise/agents/spoilage.py`:

```python
import sys

from wastewise.models import SpoilageInfo
from wastewise.agents.llm import extract_json

# Buffer fraction per risk class. "low" matches the pre-spoilage flat 15%
# buffer, so the LLM-unavailable fallback changes nothing.
BUFFER_BY_RISK = {"high": 0.05, "medium": 0.10, "low": 0.15}

_DEFAULT = SpoilageInfo(risk="low", shelf_life_days=None, live=False)

SYSTEM = (
    "You are a food-storage expert for restaurant inventory. For each "
    "ingredient in the list, estimate its typical refrigerated shelf life in "
    "days and classify spoilage risk: 'high' (3 days or less), 'medium' "
    "(4-10 days), 'low' (more than 10 days, e.g. shelf-stable staples). "
    "Respond ONLY with a JSON array, one object per ingredient, copying each "
    'name exactly: [{"item": str, "shelf_life_days": int, '
    '"risk": "high"|"medium"|"low"}].'
)


def assess_spoilage(items: list[str], llm) -> dict[str, SpoilageInfo]:
    """One call for the whole item list; per-item validation so a single bad
    entry only defaults that item, not the batch."""
    out = {i: _DEFAULT for i in items}
    if not items:
        return out
    try:
        parsed = extract_json(llm.complete(SYSTEM, "Ingredients:\n" + "\n".join(items)))
        by_name = {str(e.get("item", "")).lower(): e for e in parsed}
    except Exception as e:
        print(f"[spoilage] LLM call failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        return out
    for item in items:
        entry = by_name.get(item.lower())
        if not entry:
            continue
        risk = str(entry.get("risk", "")).lower()
        if risk not in BUFFER_BY_RISK:
            continue
        try:
            days = int(entry["shelf_life_days"])
        except (KeyError, TypeError, ValueError):
            days = None
        out[item] = SpoilageInfo(risk=risk, shelf_life_days=days, live=True)
    return out
```

`backend/wastewise/forecasting/forecaster.py` — extend the signature and the buffer line:

```python
def forecast_items(records: list[SalesRecord], horizon_days: int,
                   safety_frac: float = 0.15,
                   holiday_dates: frozenset = frozenset(),
                   buffer_fracs: dict[str, float] | None = None,
                   ) -> tuple[list[ForecastItem], BacktestStats]:
```

and inside the per-item loop:

```python
        frac = (buffer_fracs or {}).get(item, safety_frac)
        buffer = frac * pred
```

(`_backtest` keeps the flat `safety_frac` on both sides — it compares ordering *policies*, and both policies must wear the same buffer for the comparison to be fair.)

`backend/wastewise/pipeline.py` — wire it into `run_forecast` (imports: `from wastewise.agents.spoilage import assess_spoilage, BUFFER_BY_RISK`):

```python
    item_names = sorted({r.item for r in records})
    spoilage = assess_spoilage(item_names, llm)
    buffer_fracs = {n: BUFFER_BY_RISK[s.risk] for n, s in spoilage.items()}
    items, stats = forecast_items(records, horizon_days, holiday_dates=holiday_dates,
                                  buffer_fracs=buffer_fracs)
    ...
    adjusted = adjust_forecast(items, weather, future_holidays, llm)
    for a in adjusted:
        info = spoilage.get(a.item)
        if info and info.live:
            a.spoilage_risk = info.risk
            a.shelf_life_days = info.shelf_life_days
```

- [ ] **Step 4: Run the full backend suite**

Run: `pytest -q`
Expected: all pass. Integration/API tests with fake LLMs hit the spoilage fallback (`risk="low"` → 15%), so their exact-quantity assertions are unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/agents/spoilage.py backend/wastewise/models.py backend/wastewise/forecasting/forecaster.py backend/wastewise/pipeline.py backend/tests/test_spoilage.py backend/tests/test_forecaster.py
git commit -m "feat: spoilage agent sets risk-based safety buffers"
```

---

### Task 7: Spoilage chips in the forecast table

Show the agent's shelf-life knowledge and fix the now-stale "15% safety buffer" copy.

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/app/forecast/page.tsx`

**Interfaces:**
- Consumes: `spoilage_risk` / `shelf_life_days` on items (Task 6); optional in TS.

- [ ] **Step 1: Types**

In `frontend/lib/types.ts`, add to `ForecastAdjustedItem`:

```ts
  spoilage_risk?: string;          // "high" | "medium" | "low" | ""
  shelf_life_days?: number | null;
```

- [ ] **Step 2: Render**

In `frontend/app/forecast/page.tsx`:

a) Item cell — replace the plain item `<td>` with:

```tsx
                          <td className="px-4 py-3 text-sm font-medium capitalize">
                            {it.item}
                            {it.spoilage_risk === "high" ? (
                              <span className="ww-label ml-2 text-amber-700">high spoilage</span>
                            ) : null}
                            {it.shelf_life_days != null ? (
                              <span className="ww-num block text-[10px] font-normal normal-case text-muted-foreground">
                                ~{it.shelf_life_days}-day shelf life
                              </span>
                            ) : null}
                          </td>
```

b) Copy — in the intro paragraph from Task 3, change "adds a safety buffer" to "adds a spoilage-aware safety buffer (5–15% by shelf life)". In the over-ordering StatTile hint, change "both with the 15% safety buffer" to "both with the same 15% buffer (the backtest compares policies, not the spoilage-aware buffers)".

- [ ] **Step 3: Verify**

Run from `frontend/`: `npx tsc --noEmit` (no output) and `npm test` (all pass).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/app/forecast/page.tsx
git commit -m "feat: show spoilage risk and shelf life on the forecast table"
```

---

### Task 8: `/whatif` — conversational order negotiation (backend)

The single biggest "AI is real here" feature: the manager types "my budget is $1,200" or "I already have 20 lbs of rice" and the agent rewrites the order and explains the trade-off. Quantities only — the agent cannot invent items or change prices.

**Files:**
- Modify: `backend/wastewise/models.py` (`WhatIfResponse`)
- Create: `backend/wastewise/agents/whatif.py`
- Modify: `backend/wastewise/api.py` (request model + endpoint)
- Test: `backend/tests/test_whatif.py` (new)

**Interfaces:**
- Produces: `WhatIfResponse(lines: list[POLine], total: float, reply: str, live: bool)` in `models.py`.
- Produces: `negotiate_order(message: str, lines: list[POLine], llm) -> WhatIfResponse` and `REPLY_UNAVAILABLE` in `agents/whatif.py`.
- Produces: `POST /whatif` accepting `{"message": str, "lines": POLine[]}`. Task 9 calls it.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_whatif.py`:

```python
# tests/test_whatif.py
import json

from wastewise.models import POLine
from wastewise.agents.whatif import negotiate_order, REPLY_UNAVAILABLE


def _lines():
    return [
        POLine(item="Rice", qty=25, supplier="Kroger", unit_price=1.79,
               line_total=44.75, note="", live=True),
        POLine(item="Rohu Fish", qty=30, supplier="Kroger", unit_price=12.99,
               line_total=389.70, note="", live=True),
    ]


class _TrimLLM:
    def complete(self, system, user):
        return json.dumps({
            "updates": [{"item": "rohu fish", "qty": 20}],
            "reply": "Cut Rohu fish to 20 to fit the budget; it is the most expensive line.",
        })


def test_negotiate_applies_updates_and_recomputes_totals():
    resp = negotiate_order("keep it under $350", _lines(), _TrimLLM())
    by_item = {l.item: l for l in resp.lines}
    assert by_item["Rohu Fish"].qty == 20            # matched case-insensitively
    assert by_item["Rohu Fish"].line_total == 259.80
    assert by_item["Rice"].qty == 25                 # untouched line preserved
    assert resp.total == round(44.75 + 259.80, 2)
    assert resp.live is True
    assert "Rohu" in resp.reply or "budget" in resp.reply


class _HallucinatingLLM:
    def complete(self, system, user):
        return json.dumps({
            "updates": [{"item": "lobster", "qty": 99}, {"item": "rice", "qty": -5}],
            "reply": "Added lobster!",
        })


def test_unknown_items_ignored_and_negative_qty_clamped_to_zero():
    resp = negotiate_order("whatever", _lines(), _HallucinatingLLM())
    assert {l.item for l in resp.lines} == {"Rice", "Rohu Fish"}  # no lobster
    by_item = {l.item: l for l in resp.lines}
    assert by_item["Rice"].qty == 0.0
    assert by_item["Rice"].line_total == 0.0


class _DownLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_fallback_leaves_order_unchanged():
    resp = negotiate_order("budget $1", _lines(), _DownLLM())
    assert [l.qty for l in resp.lines] == [25, 30]
    assert resp.reply == REPLY_UNAVAILABLE
    assert resp.live is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_whatif.py -v`
Expected: FAIL with `No module named 'wastewise.agents.whatif'`.

- [ ] **Step 3: Implement**

`backend/wastewise/models.py`:

```python
class WhatIfResponse(BaseModel):
    lines: list[POLine]
    total: float
    reply: str
    live: bool
```

Create `backend/wastewise/agents/whatif.py`:

```python
import sys

from wastewise.models import POLine, WhatIfResponse
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing copilot. You are given the current "
    "purchase-order lines (item, quantity, unit price, line total, grand "
    "total) and an instruction from the restaurant manager. Work out which "
    "quantity changes satisfy the instruction. You may ONLY change "
    "quantities (0 is allowed, to drop a line); you cannot change prices or "
    "add items that are not on the order. If the instruction sets a budget, "
    "trim the most expensive lines first and explain the trade-off. If the "
    "instruction says stock is already on hand, subtract it from that "
    "item's quantity. If the instruction is unclear or unrelated to this "
    "order, return an empty updates list and ask for clarification in the "
    'reply. Respond ONLY with JSON: {"updates": [{"item": str, "qty": '
    'number}], "reply": str}. "item" must copy a name from the order '
    'exactly. "reply" is 1-3 English sentences summarizing what you changed '
    "and why."
)

REPLY_UNAVAILABLE = "AI assistant unavailable — the order was left unchanged."


def negotiate_order(message: str, lines: list[POLine], llm) -> WhatIfResponse:
    table = "\n".join(
        f"- {l.item}: qty {l.qty}, unit ${l.unit_price:.2f}, line ${l.line_total:.2f}"
        for l in lines)
    total = round(sum(l.line_total for l in lines), 2)
    user = f"Order:\n{table}\nGrand total: ${total:.2f}\n\nInstruction: {message}"
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        updates = {str(u["item"]).strip().lower(): float(u["qty"])
                   for u in parsed.get("updates", [])}
        reply = str(parsed["reply"]).strip()
        if not reply:
            raise ValueError("empty reply")
    except Exception as e:
        print(f"[whatif] LLM call failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        return WhatIfResponse(lines=lines, total=total,
                              reply=REPLY_UNAVAILABLE, live=False)
    # Apply quantity updates only to items that exist on the order -- a
    # hallucinated item name must never add a line.
    new_lines = []
    for l in lines:
        qty = max(0.0, updates.get(l.item.lower(), l.qty))
        new_lines.append(l.model_copy(update={
            "qty": qty, "line_total": round(l.unit_price * qty, 2)}))
    new_total = round(sum(l.line_total for l in new_lines), 2)
    return WhatIfResponse(lines=new_lines, total=new_total, reply=reply, live=True)
```

`backend/wastewise/api.py` — add the import, request model, and endpoint:

```python
from wastewise.agents.whatif import negotiate_order
```

```python
class WhatIfRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    lines: list[POLine]
```

```python
@app.post("/whatif")
def whatif(req: WhatIfRequest, deps: dict = Depends(get_deps)):
    return negotiate_order(req.message, req.lines, deps["llm"])
```

- [ ] **Step 4: Run the full backend suite**

Run: `pytest -q` — all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/agents/whatif.py backend/wastewise/api.py backend/tests/test_whatif.py
git commit -m "feat: /whatif endpoint negotiates order quantities in natural language"
```

---

### Task 9: "Negotiate the order" box on the order page

**Files:**
- Modify: `frontend/lib/types.ts` (`WhatIfResponse`)
- Modify: `frontend/lib/api.ts` (`runWhatIf`)
- Modify: `frontend/app/order/page.tsx`

**Interfaces:**
- Consumes: `POST /whatif` (Task 8).
- Produces: `runWhatIf(message: string, lines: POLine[], total: number): Promise<WhatIfResponse>` in `api.ts`.

- [ ] **Step 1: Types + API client**

`frontend/lib/types.ts`:

```ts
export interface WhatIfResponse {
  lines: POLine[];
  total: number;
  reply: string;
  live: boolean;
}
```

`frontend/lib/api.ts` (import `WhatIfResponse` in the type import at the top):

```ts
export function runWhatIf(message: string, lines: POLine[], total: number): Promise<WhatIfResponse> {
  // Demo fallback echoes the order unchanged: the negotiation agent needs
  // the live backend, and pretending otherwise would fake an AI result.
  return call("/whatif", jsonInit({ message, lines }), {
    lines,
    total,
    reply: "The what-if assistant needs the live backend — demo mode leaves the order unchanged.",
    live: false,
  });
}
```

- [ ] **Step 2: Order-page UI**

In `frontend/app/order/page.tsx`:

a) Imports and state:

```tsx
import { runRationale, runWhatIf } from "@/lib/api";
```

```tsx
  const [whatIfMsg, setWhatIfMsg] = useState("");
  const [whatIfReply, setWhatIfReply] = useState<string | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
```

b) Handler (next to `updateQty`; mirrors its rationale-invalidation behavior):

```tsx
  async function askWhatIf(e: React.FormEvent) {
    e.preventDefault();
    if (!sourcing || !whatIfMsg.trim() || whatIfLoading) return;
    setWhatIfLoading(true);
    try {
      const res = await runWhatIf(whatIfMsg.trim(), sourcing.lines, sourcing.total);
      // The agent rewrote quantities -> the old rationale's figures are stale.
      started.current = true;
      set({ sourcing: { ...sourcing, lines: res.lines, total: res.total }, rationale: null });
      setWhatIfReply(res.reply);
      setApproved(false);
      setWhatIfMsg("");
    } catch {
      setWhatIfReply("Something went wrong — the order was not changed.");
    } finally {
      setWhatIfLoading(false);
    }
  }
```

c) Section between the rationale card and Tbl. 3:

```tsx
      <div>
        <p className="ww-label mb-2">Negotiate the order</p>
        <div className="space-y-3 border border-foreground/20 bg-card px-4 py-4">
          <form onSubmit={askWhatIf} className="flex flex-wrap gap-2">
            <input
              type="text"
              value={whatIfMsg}
              onChange={(e) => setWhatIfMsg(e.target.value)}
              maxLength={500}
              placeholder='e.g. "keep it under $1,200" or "I already have 20 lbs of rice"'
              aria-label="Instruction for the purchasing copilot"
              className="min-w-0 flex-1 border border-foreground/25 bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <Button type="submit" disabled={whatIfLoading || !whatIfMsg.trim()}>
              {whatIfLoading ? "Thinking…" : "Ask AI"}
            </Button>
          </form>
          {whatIfReply ? (
            <div className="space-y-1">
              <span className="ww-label text-accent">AI copilot</span>
              <p className="text-sm leading-relaxed text-foreground">{whatIfReply}</p>
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              Tell the AI a budget, on-hand stock, or a scenario — it rewrites the
              quantities below and explains the trade-off.
            </p>
          )}
        </div>
      </div>
```

- [ ] **Step 3: Verify**

Run from `frontend/`: `npx tsc --noEmit` (no output) and `npm test` (all pass). Then exercise it end-to-end: start the backend (`uvicorn wastewise.api:app` from `backend/`) and `npm run dev` from `frontend/`, run the demo flow to the order page, type "keep it under $1,200", and confirm quantities and the grand total change and the reply renders.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts frontend/app/order/page.tsx
git commit -m "feat: negotiate-the-order copilot on the purchase order page"
```

---

### Task 10: LLM column mapping for messy CSVs

Make the *first* 30 seconds of the demo an AI moment: any sales export works. Deterministic path first — the LLM is only consulted when the canonical headers are missing, so clean CSVs cost nothing.

**Files:**
- Modify: `backend/wastewise/ingest.py`
- Modify: `backend/wastewise/api.py` (pass the LLM into parsing)
- Modify: `frontend/components/ui/csv-dropzone.tsx` (copy)
- Test: `backend/tests/test_ingest.py`

**Interfaces:**
- Produces: `parse_sales_csv(text: str, llm=None) -> list[SalesRecord]` — backward compatible; `llm=None` behaves exactly as today.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_ingest.py`:

```python
import json

MESSY = ("Day,Product,Units Sold,Cost\n"
         "07/01/2026,eggs,12,3.5\n"
         "07/02/2026,eggs,9,3.5\n")


class _MappingLLM:
    def complete(self, system, user):
        return json.dumps({"date": "Day", "item": "Product",
                           "quantity": "Units Sold", "price": "Cost",
                           "date_format": "%m/%d/%Y"})


def test_llm_maps_nonstandard_columns():
    from wastewise.ingest import parse_sales_csv
    records = parse_sales_csv(MESSY, llm=_MappingLLM())
    assert len(records) == 2
    assert records[0].item == "eggs"
    assert records[0].quantity == 12.0
    assert records[0].price == 3.5
    assert str(records[0].date) == "2026-07-01"


def test_without_llm_messy_csv_still_raises():
    from wastewise.ingest import parse_sales_csv
    import pytest
    with pytest.raises(ValueError):
        parse_sales_csv(MESSY)


class _BadMappingLLM:
    def complete(self, system, user):
        return json.dumps({"date": "Nope", "item": "Product",
                           "quantity": "Units Sold", "price": None,
                           "date_format": "%m/%d/%Y"})


def test_mapping_to_missing_column_raises_clean_error():
    from wastewise.ingest import parse_sales_csv
    import pytest
    with pytest.raises(ValueError):
        parse_sales_csv(MESSY, llm=_BadMappingLLM())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ingest.py -v`
Expected: the two LLM tests FAIL with `TypeError: parse_sales_csv() got an unexpected keyword argument 'llm'`.

- [ ] **Step 3: Implement**

Rewrite `backend/wastewise/ingest.py` (keep `summarize` as is):

```python
import csv
import datetime
import io
import sys
from wastewise.models import SalesRecord, DatasetSummary

REQUIRED = {"date", "item", "quantity"}

MAPPING_SYSTEM = (
    "You map arbitrary sales-CSV headers onto a canonical schema. Given the "
    "header row and a few sample data rows, identify which column holds the "
    "sale date, which holds the item/product name, which holds the quantity "
    "sold, and (optionally) which holds the unit price. Also give the Python "
    "strptime pattern that parses the date column (e.g. \"%m/%d/%Y\"), or "
    "\"iso\" for ISO dates. Column names must be copied EXACTLY from the "
    'header. Respond ONLY with JSON: {"date": str, "item": str, '
    '"quantity": str, "price": str|null, "date_format": str}.'
)


def _parse_date(raw: str, fmt: str) -> datetime.date:
    if fmt == "iso":
        return datetime.date.fromisoformat(raw)
    return datetime.datetime.strptime(raw, fmt).date()


def _parse_rows(reader: csv.DictReader, cols: dict[str, str | None],
                date_format: str) -> list[SalesRecord]:
    records = []
    for i, row in enumerate(reader, start=2):  # row 1 is the header
        try:
            price_col = cols.get("price")
            records.append(SalesRecord(
                date=_parse_date((row[cols["date"]] or "").strip(), date_format),
                item=(row[cols["item"]] or "").strip(),
                quantity=float(row[cols["quantity"]]),
                price=float(row[price_col]) if price_col and row.get(price_col) else None,
            ))
        except (TypeError, ValueError, KeyError) as e:
            # Ragged rows leave required fields as None (-> TypeError) and bad
            # dates/numbers raise ValueError; surface both as a 400-friendly error.
            raise ValueError(f"Invalid CSV row {i}: {e}") from e
    return records


def _llm_column_mapping(fieldnames: list[str], sample_rows: list[dict],
                        llm) -> tuple[dict[str, str | None], str]:
    from wastewise.agents.llm import extract_json  # local import: avoid cycle
    sample = "\n".join(",".join(str(r.get(f, "")) for f in fieldnames)
                       for r in sample_rows)
    user = f"Header: {','.join(fieldnames)}\nSample rows:\n{sample}"
    parsed = extract_json(llm.complete(MAPPING_SYSTEM, user))
    cols = {"date": parsed["date"], "item": parsed["item"],
            "quantity": parsed["quantity"], "price": parsed.get("price")}
    for role, col in cols.items():
        if col is not None and col not in fieldnames:
            raise ValueError(f"AI mapped '{role}' to missing column '{col}'")
    return cols, str(parsed.get("date_format", "iso"))


def parse_sales_csv(text: str, llm=None) -> list[SalesRecord]:
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    if REQUIRED.issubset(set(reader.fieldnames)):
        cols = {"date": "date", "item": "item", "quantity": "quantity",
                "price": "price" if "price" in reader.fieldnames else None}
        return _parse_rows(reader, cols, "iso")
    if llm is None:
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}")
    # Nonstandard header: ask the LLM to map columns, then re-read from the top.
    sample_reader = csv.DictReader(io.StringIO(text))
    sample_rows = [row for row, _ in zip(sample_reader, range(5))]
    try:
        cols, date_format = _llm_column_mapping(list(reader.fieldnames),
                                                sample_rows, llm)
    except ValueError:
        raise
    except Exception as e:
        print(f"[ingest] LLM column mapping failed: {type(e).__name__}: {e}",
              file=sys.stderr, flush=True)
        raise ValueError(f"CSV must contain columns: {sorted(REQUIRED)}") from e
    return _parse_rows(csv.DictReader(io.StringIO(text)), cols, date_format)
```

In `backend/wastewise/api.py`, pass the LLM in `upload`:

```python
        records = parse_sales_csv(text, llm=deps["llm"])
```

In `frontend/components/ui/csv-dropzone.tsx`, change the helper copy (line ~184):

```tsx
              Any sales CSV — AI maps your columns &middot; up to 5 MB
```

- [ ] **Step 4: Run the full backend suite and frontend gates**

Run from `backend/`: `pytest -q` — all pass (clean-CSV tests never reach the LLM path).
Run from `frontend/`: `npx tsc --noEmit` and `npm test` — pass.

- [ ] **Step 5: Commit**

```bash
git add backend/wastewise/ingest.py backend/wastewise/api.py backend/tests/test_ingest.py frontend/components/ui/csv-dropzone.tsx
git commit -m "feat: AI column mapping accepts nonstandard sales CSVs"
```
