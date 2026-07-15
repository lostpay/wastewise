# AI-Centered UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WasteWise's AI reasoning visibly central to the product instead of decorative, per `docs/specs/2026-07-10-ai-centered-ux-design.md`: per-item (not batched) adjustment reasoning, a `live` flag threaded end-to-end so the UI never has to string-sniff whether a response was real inference or a fallback, louder/always-visible reason surfacing on Forecast and Sourcing, and a new synthesis paragraph on the Order page tying the whole pipeline together.

**Architecture:** Backend: `adjustment.py` moves from one all-items LLM call to one call per item run on a `ThreadPoolExecutor` (mirroring the pattern already proven in `sourcing.py`'s `_choose_offer`/`_resolve`); both `AdjustedItem` and `POLine` gain a `live: bool`; a new `agents/rationale.py` + `pipeline.run_rationale` + `POST /rationale` produce one synthesis paragraph per order with a deterministic fallback. Frontend: `live` replaces all magic-string sniffing (`reason === "No adjustment applied."`, `supplier === "Market"` for AI-liveness purposes — `SupplierPrice`'s existing "Market" concept for *retail availability* is untouched and stays orthogonal); `ReasonBadge` and `PriceTable`'s note column both become louder and branch on `live`; Order gets a new rationale card wired the same way Forecast/Sourcing fetch on mount.

**Tech Stack:** Python 3.10 / FastAPI / pytest (backend), Next.js App Router / TypeScript / Vitest + Testing Library (frontend). No new dependencies.

## Global Constraints

- Submission deadline: 2026-07-11 15:00 UTC. Every task must leave `pytest -q` (backend, run from `backend/`) and `npx vitest run` + `npx tsc --noEmit` (frontend, run from `frontend/`) green before committing — do not let failures accumulate across tasks this close to the deadline.
- Every LLM-facing call keeps the existing house style: schema-validated where structured, deterministic fallback on any parse/exception path, all LLM output in English. Do not weaken this anywhere in this plan.
- `ThreadPoolExecutor(max_workers=min(8, len(items)) or 1)` is the established concurrency pattern (see current `sourcing.py`) — reuse it verbatim for `adjustment.py`; do not invent a new concurrency primitive.
- `AdjustedItem.live` / `POLine.live` are **required** fields (no default), matching every other field on those models (`forecast`, `reason`, `note`, etc. all have no default either) — every construction site must set it explicitly.
- Do not touch the forecasting model (XGBoost/baseline), data adapters (weather/holidays/FRED/Kroger), or unify `ReasonBadge`/`PriceTable` into one component — all explicitly out of scope per the spec.
- Do not gate the Order page's Approve/Download actions on the rationale call completing or succeeding.
- Per the spec's own risk note: smoke-test the adjustment and rationale call paths against the real vLLM endpoint (not just mocked-LLM unit tests) before considering this done — Task 9 covers this.

---

### Task 1: Backend models — `live` fields + `RationaleResponse`

**Files:**
- Modify: `backend/wastewise/models.py`
- Modify: `backend/tests/test_models.py`

**Interfaces:**
- Modifies: `AdjustedItem` gains `live: bool` (required).
- Modifies: `POLine` gains `live: bool` (required).
- Produces: `RationaleResponse(paragraph: str, live: bool)` — consumed by Task 4 (`agents/rationale.py`, `pipeline.py`, `api.py`).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_models.py`:

```python
from wastewise.models import AdjustedItem, RationaleResponse


def test_adjusted_item_requires_live_flag():
    item = AdjustedItem(item="cabbage", forecast=100.0, adjusted_qty=90.0,
                        reason="Rain lowers demand.", live=True)
    assert item.live is True


def test_rationale_response_roundtrips():
    resp = RationaleResponse(paragraph="Rain lowers demand; sourcing saves $10.", live=True)
    assert resp.model_dump()["live"] is True
```

Also update the existing `POLine` construction in the same file (it will fail once `live` becomes required):

```python
def test_sourcing_response_roundtrips():
    line = POLine(item="cabbage", qty=12, supplier="Kroger",
                  unit_price=1.5, line_total=18.0, note="8% under market", live=True)
    resp = SourcingResponse(lines=[line], total=18.0, savings=1.6)
    assert resp.model_dump()["lines"][0]["supplier"] == "Kroger"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: FAIL — `ImportError: cannot import name 'RationaleResponse'` and a `ValidationError: live Field required` on the `POLine` construction.

- [ ] **Step 3: Update `models.py`**

In `backend/wastewise/models.py`, change:

```python
class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str
```

to:

```python
class AdjustedItem(BaseModel):
    item: str
    forecast: float
    adjusted_qty: float
    reason: str
    live: bool
```

Change:

```python
class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str
```

to:

```python
class POLine(BaseModel):
    item: str
    qty: float
    supplier: str
    unit_price: float
    line_total: float
    note: str
    live: bool
```

Add at the end of the file:

```python
class RationaleResponse(BaseModel):
    paragraph: str
    live: bool
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_models.py -v`
Expected: PASS (4 tests: 2 pre-existing + 2 new).

- [ ] **Step 5: Confirm the rest of the suite fails loudly where `live` is now missing (expected, fixed in Tasks 2–4)**

Run: `cd backend && python -m pytest -q`
Expected: FAIL in `test_adjustment.py`, `test_sourcing.py`, `test_pipeline.py`, `test_integration.py`, `test_api.py` (all construct `AdjustedItem`/`POLine` indirectly via code that doesn't set `live` yet). This is expected — Tasks 2–4 fix each in turn. Do not attempt to fix them here.

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/models.py backend/tests/test_models.py
git commit -m "feat: add live flag to AdjustedItem/POLine and a new RationaleResponse model"
```

---

### Task 2: Backend — parallelize the adjustment agent per item with real differentiation

**Files:**
- Modify: `backend/wastewise/agents/adjustment.py`
- Modify: `backend/tests/test_adjustment.py`
- Modify: `backend/tests/test_integration.py`

**Interfaces:**
- Consumes: `AdjustedItem` from Task 1 (now requires `live`).
- Produces: `adjustment.FALLBACK_REASON: str` constant — consumed by Task 6's frontend `ReasonBadge` fallback-copy expectations (string content only; not imported cross-language, just kept in sync).
- Modifies: `adjust_forecast(items, weather, holidays, llm) -> list[AdjustedItem]` — same signature, now makes one LLM call per item concurrently instead of one call for all items.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `backend/tests/test_adjustment.py`:

```python
# tests/test_adjustment.py
from wastewise.models import ForecastItem, WeatherInfo
from wastewise.agents.adjustment import adjust_forecast, FALLBACK_REASON


def _items():
    return [
        ForecastItem(item="stew", forecast=100, baseline=95, safety_buffer=15,
                    recommended_purchase_qty=115),
        ForecastItem(item="salad greens", forecast=80, baseline=75,
                    safety_buffer=10, recommended_purchase_qty=90),
    ]


class _PerItemLLM:
    """Returns a different, item-specific completion per call -- proves each
    item gets its own reasoning instead of a shared/copy-pasted one."""
    _RESPONSES = {
        "stew": '{"adjusted_qty": 130, "reason": "Rain drives comfort-food orders like stew up."}',
        "salad greens": '{"adjusted_qty": 60, "reason": "Rain lowers dine-in demand for cold salad items."}',
    }

    def complete(self, system, user):
        for item, resp in self._RESPONSES.items():
            if f"Item: {item}," in user:
                return resp
        raise AssertionError(f"unexpected item in prompt: {user}")


def test_adjusts_each_item_with_genuinely_different_reasoning():
    weather = WeatherInfo(condition="Rain", temp_c=15, precipitation_mm=8)
    out = adjust_forecast(_items(), weather, [], _PerItemLLM())
    by_item = {o.item: o for o in out}
    assert by_item["stew"].adjusted_qty == 130
    assert by_item["salad greens"].adjusted_qty == 60
    assert by_item["stew"].reason != by_item["salad greens"].reason
    assert all(o.live for o in out)


class _BadJsonLLM:
    def complete(self, system, user):
        return "not json"


def test_fallback_on_bad_json_marks_not_live():
    out = adjust_forecast(_items(), WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], _BadJsonLLM())
    assert out[0].adjusted_qty == 115  # unchanged recommended qty
    assert out[0].reason == FALLBACK_REASON
    assert out[0].live is False


class _MixedLLM:
    """One item's call succeeds, the other's returns garbage -- proves a
    single bad call only zeroes out that one item, not the whole batch."""
    def complete(self, system, user):
        if "Item: stew," in user:
            return '{"adjusted_qty": 130, "reason": "Rain drives comfort-food orders like stew up."}'
        return "not json"


def test_one_items_failure_does_not_affect_another_items_success():
    out = adjust_forecast(_items(), WeatherInfo(condition="Rain", temp_c=15,
                          precipitation_mm=8), [], _MixedLLM())
    by_item = {o.item: o for o in out}
    assert by_item["stew"].live is True
    assert by_item["stew"].adjusted_qty == 130
    assert by_item["salad greens"].live is False
    assert by_item["salad greens"].reason == FALLBACK_REASON


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_fallback_on_llm_transport_error():
    items = _items()
    out = adjust_forecast(items, WeatherInfo(condition="Clear", temp_c=25,
                          precipitation_mm=0), [], _RaisingLLM())
    assert all(o.adjusted_qty == i.recommended_purchase_qty for o, i in zip(out, items))
    assert all(o.reason == FALLBACK_REASON for o in out)
    assert all(o.live is False for o in out)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_adjustment.py -v`
Expected: FAIL — `ImportError: cannot import name 'FALLBACK_REASON'` (module doesn't export it yet), plus the old single-call implementation doesn't match the new per-item prompt shape (`f"Item: {item},"` never appears in the current `user` string).

- [ ] **Step 3: Rewrite `adjustment.py`**

Replace the full contents of `backend/wastewise/agents/adjustment.py`:

```python
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import ForecastItem, AdjustedItem, WeatherInfo, Holiday
from wastewise.agents.llm import extract_json

SYSTEM = (
    "You are a restaurant purchasing assistant. You are given ONE item's "
    "recommended purchase quantity plus the day's weather and holidays. "
    "Adjust the quantity up or down based on how weather and holidays "
    "specifically affect THIS item's category, and give a one-sentence "
    "reason. The same weather condition affects different item categories "
    "differently -- never reuse a generic reason across items.\n\n"
    "Examples of the differentiation expected:\n"
    "- Rain, item 'beef stew' (hot/comfort food): demand goes UP on rainy "
    'days -> {"adjusted_qty": 145, "reason": "Rain drives comfort-food '
    'orders like stew up."}\n'
    "- Rain, item 'mixed salad greens' (cold/perishable): demand goes DOWN "
    'as dine-in traffic drops -> {"adjusted_qty": 80, "reason": "Rain '
    'lowers dine-in demand for cold salad items."}\n'
    "- Holiday (e.g. Thanksgiving), item 'turkey' (bulk/gathering item): "
    'demand goes UP for large-format group-meal items -> {"adjusted_qty": '
    '220, "reason": "Thanksgiving drives bulk turkey purchases for '
    'gatherings."}\n\n'
    'Respond ONLY with JSON: {"adjusted_qty": number, "reason": str}. '
    "Reply in English."
)

FALLBACK_REASON = "AI reasoning unavailable — using base forecast."


def _adjust_one(item: ForecastItem, weather: WeatherInfo, holiday_txt: str, llm) -> AdjustedItem:
    user = (f"Weather: {weather.condition}, {weather.temp_c}C, "
            f"precip {weather.precipitation_mm}mm. Holidays: {holiday_txt}.\n"
            f"Item: {item.item}, recommended quantity: {item.recommended_purchase_qty}.")
    try:
        parsed = extract_json(llm.complete(SYSTEM, user))
        adjusted_qty = float(parsed["adjusted_qty"])
        reason = str(parsed["reason"]).strip()
        if not reason:
            raise ValueError("empty reason")
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=adjusted_qty, reason=reason, live=True)
    except Exception:
        return AdjustedItem(item=item.item, forecast=item.forecast,
                            adjusted_qty=item.recommended_purchase_qty,
                            reason=FALLBACK_REASON, live=False)


def adjust_forecast(items: list[ForecastItem], weather: WeatherInfo,
                    holidays: list[Holiday], llm) -> list[AdjustedItem]:
    holiday_txt = ", ".join(h.name for h in holidays) or "none"

    def _adjust_one_partial(item):
        return _adjust_one(item, weather, holiday_txt, llm)

    # One call per item, run concurrently -- each item only sees its own name
    # and quantity, so the model structurally cannot copy-paste reasoning
    # across items regardless of prompt wording (see SYSTEM above).
    with ThreadPoolExecutor(max_workers=min(8, len(items)) or 1) as pool:
        return list(pool.map(_adjust_one_partial, items))
```

- [ ] **Step 4: Run the adjustment test file**

Run: `cd backend && python -m pytest tests/test_adjustment.py -v`
Expected: `4 passed`.

- [ ] **Step 5: Fix `test_integration.py`'s fake LLM for the new per-item prompt shape**

In `backend/tests/test_integration.py`, change:

```python
class _LLM:
    def complete(self, system, user):
        # valid adjustment JSON for the adjustment step; plain note otherwise
        if "JSON array" in system:
            return ('[{"item":"cabbage","adjusted_qty":30,"reason":"Rain lowers demand"},'
                    '{"item":"pork","adjusted_qty":20,"reason":"Rain lowers demand"},'
                    '{"item":"chicken","adjusted_qty":28,"reason":"Rain lowers demand"}]')
        return "Kroger is 30% below market."
```

to:

```python
class _LLM:
    def complete(self, system, user):
        # adjustment.py's per-item prompt asks for {"adjusted_qty":..,"reason":..};
        # sourcing.py's selection prompt asks for {"index":..,"reason":..}. A plain
        # sentence here exercises sourcing's fallback path, which is fine for this
        # end-to-end smoke test (it only checks totals/line counts, not exact notes).
        if "adjusted_qty" in system:
            return '{"adjusted_qty": 25, "reason": "Rain lowers dine-in demand for this item."}'
        return "Kroger is 30% below market."
```

- [ ] **Step 6: Run the integration test**

Run: `cd backend && python -m pytest tests/test_integration.py -v`
Expected: PASS.

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: `test_adjustment.py` and `test_integration.py` now pass; `test_sourcing.py`, `test_pipeline.py`, `test_api.py` still fail (fixed in Tasks 3–4) — confirm no *new* failures were introduced by this task beyond what Task 1 already flagged.

- [ ] **Step 8: Commit**

```bash
git add backend/wastewise/agents/adjustment.py backend/tests/test_adjustment.py backend/tests/test_integration.py
git commit -m "feat: parallelize adjustment agent per item with differentiated reasoning + live flag"
```

---

### Task 3: Backend — thread `live` through the sourcing agent

**Files:**
- Modify: `backend/wastewise/agents/sourcing.py`
- Modify: `backend/tests/test_sourcing.py`

**Interfaces:**
- Consumes: `POLine` from Task 1 (now requires `live`).
- Modifies: `_choose_offer(llm, item, offers, benchmark) -> tuple[SupplierPrice, str, bool]` — third element is `True` only on the LLM-selection success path.
- Modifies: `source_order(...)` — every `POLine` it builds now sets `live` from the resolved tuple's third element (`False` on every non-`_choose_offer` path: no-offers-but-benchmark, and no-offers-no-benchmark).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_sourcing.py`, add `live` assertions to the existing tests. Replace the full contents of the file:

```python
# tests/test_sourcing.py
import json
from wastewise.models import SupplierPrice
from wastewise.agents.sourcing import source_order, NO_BENCHMARK_NOTE, NO_MATCH_NOTE


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
    assert line.live is False  # _FakeLLM's reply isn't valid selection JSON


class _NoRetail:
    def get_retail_prices(self, item, location): return []


def test_source_order_falls_back_to_market_when_no_retail():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0
    assert resp.lines[0].live is False


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("simulated LLM outage")


def test_source_order_fallback_note_uses_retail_average_language():
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _RaisingLLM(), "loc")
    assert resp.lines[0].note == "At or above the US retail average."
    assert resp.lines[0].live is False


class _NoWholesale:
    def get_wholesale_price(self, item): return None


def test_source_order_no_benchmark_note_is_honest_not_misleading():
    resp = source_order([{"item": "cabbage", "qty": 10}],
                        _NoWholesale(), _Retail(), _FakeLLM(), "loc")
    assert resp.lines[0].note == NO_BENCHMARK_NOTE


def test_source_order_no_retail_and_no_benchmark_is_honest_zero():
    resp = source_order([{"item": "mutton", "qty": 5}],
                        _NoWholesale(), _NoRetail(), _FakeLLM(), "loc")
    line = resp.lines[0]
    assert line.supplier == "No price data"
    assert line.unit_price == 0.0
    assert line.note == NO_MATCH_NOTE
    assert line.live is False


def test_source_order_still_falls_back_to_market_when_benchmark_exists():
    # Regression guard: no retail offers but a real benchmark still prices
    # at the benchmark, not $0 -- this behavior must not change.
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0


class _MultiRetail:
    def get_retail_prices(self, item, location):
        return [
            SupplierPrice(supplier="Kroger", unit_price=10.0,
                         description="Private Selection Marinated Chicken Thighs"),
            SupplierPrice(supplier="Kroger", unit_price=4.5,
                         description="Kroger Chicken Breast"),
        ]


class _SelectingLLM:
    """Simulates the model picking the plain (index 1) option over the
    marinated one, and explaining why."""
    def complete(self, system, user):
        return json.dumps({"index": 1, "reason": "Plain cut, well under benchmark."})


def test_source_order_uses_llm_to_pick_best_candidate_not_just_cheapest_index0():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _SelectingLLM(), "loc")
    line = resp.lines[0]
    assert line.unit_price == 4.5
    assert line.note == "Plain cut, well under benchmark."
    assert line.live is True


class _MalformedLLM:
    def complete(self, system, user):
        return "not json at all"


def test_source_order_falls_back_to_cheapest_when_llm_output_unusable():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _MalformedLLM(), "loc")
    line = resp.lines[0]
    assert line.unit_price == 4.5  # still the cheapest candidate
    # _Wholesale's benchmark (2.0) is below the cheapest candidate (4.5), so the
    # deterministic fallback note is honestly "at or above", not "under".
    assert line.note == "At or above the US retail average."
    assert line.live is False


class _OutOfRangeLLM:
    def complete(self, system, user):
        return json.dumps({"index": 99, "reason": "bad index"})


def test_source_order_falls_back_when_llm_picks_out_of_range_index():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _OutOfRangeLLM(), "loc")
    assert resp.lines[0].unit_price == 4.5
    assert resp.lines[0].live is False
```

- [ ] **Step 2: Run tests to verify the `live` assertions fail**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v`
Expected: FAIL — every test hits `ValidationError: live Field required` since `source_order` doesn't set `live` on `POLine` yet.

- [ ] **Step 3: Rewrite `sourcing.py`**

Replace the full contents of `backend/wastewise/agents/sourcing.py`:

```python
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse, SupplierPrice
from wastewise.agents.llm import extract_json

SELECT_SYSTEM = (
    "You are a restaurant purchasing agent choosing which supplier listing to buy "
    "for a bulk kitchen order. Given a plain ingredient name, a US retail average "
    "benchmark price (BLS, via FRED) (or 'none' if unavailable), and a numbered "
    "list of candidate retail listings (each with a description and unit price), "
    "pick the listing that is the plain, unprocessed commodity form of the "
    "ingredient -- not a marinated, seasoned, or specialty product -- at the best "
    "price. Respond ONLY with JSON: {\"index\": int, \"reason\": str}. \"index\" is "
    'the 0-based position in the candidate list. "reason" is one short English '
    "sentence explaining the choice. If the benchmark is 'none', do NOT claim or "
    "imply a comparison to it (e.g. never say 'under the US retail average' or "
    "'at or above the US retail average') -- explain the choice in terms of the "
    "listing itself (e.g. plain cut vs. specialty, or lowest price among "
    "candidates) instead."
)

NO_BENCHMARK_NOTE = "No US retail average available for comparison."
NO_MATCH_NOTE = "No retail listing or US retail average found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"{pct}% under the US retail average."
    return "At or above the US retail average."


def _choose_offer(llm, item: str, offers: list[SupplierPrice],
                  benchmark: float | None) -> tuple[SupplierPrice, str, bool]:
    """Ask the LLM to pick the best candidate + explain; fall back to the
    cheapest offer with a formulaic note if the LLM is unavailable or
    returns something unusable. `offers` must be non-empty. The third
    element of the return tuple is `live` -- True only on the LLM-selection
    success path."""
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
        if not (0 <= idx < len(offers)) or not reason:
            raise ValueError("bad selection")
        return offers[idx], reason, True
    except Exception:
        return fallback_best, _fallback_note(fallback_best.unit_price, benchmark), False


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str) -> SourcingResponse:
    prepared = []
    for entry in items:
        item, qty = entry["item"], float(entry["qty"])
        benchmark = wholesale.get_wholesale_price(item)
        offers = retail.get_retail_prices(item, location)
        prepared.append((item, qty, benchmark, offers))

    def _resolve(p):
        item, qty, benchmark, offers = p
        if offers:
            return _choose_offer(llm, item, offers, benchmark)
        if benchmark is not None:
            return None, _fallback_note(benchmark, benchmark), False
        return None, NO_MATCH_NOTE, False

    # Choosing an offer and writing its note is an independent LLM call per
    # item -- run them concurrently instead of one at a time, since each
    # round trip dominates wall time otherwise.
    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        resolved = list(pool.map(_resolve, prepared))

    total = 0.0
    savings = 0.0
    lines = []
    for (item, qty, benchmark, offers), (offer, note, live) in zip(prepared, resolved):
        if offer is not None:
            supplier, unit_price = offer.supplier, offer.unit_price
        elif benchmark is not None:
            supplier, unit_price = "Market", benchmark
        else:
            supplier, unit_price = "No price data", 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        lines.append(POLine(item=item, qty=qty, supplier=supplier,
                            unit_price=unit_price, line_total=line_total,
                            note=note, live=live))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
```

- [ ] **Step 4: Run the sourcing test file**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v`
Expected: `9 passed`.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: `test_sourcing.py` now passes; `test_pipeline.py`/`test_api.py` still fail where they build `POLine`/`AdjustedItem` without `live` — fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "feat: thread live flag through sourcing agent's offer selection"
```

---

### Task 4: Backend — new rationale agent, pipeline wiring, and `/rationale` endpoint

**Files:**
- Create: `backend/wastewise/agents/rationale.py`
- Create: `backend/tests/test_rationale.py`
- Modify: `backend/wastewise/pipeline.py`
- Modify: `backend/tests/test_pipeline.py`
- Modify: `backend/wastewise/api.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- Produces: `rationale.write_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float, total: float, llm) -> RationaleResponse`.
- Produces: `pipeline.run_rationale(items, lines, savings, total, llm) -> RationaleResponse` (thin wrapper, same signature, mirrors `run_forecast`/`run_sourcing` wrapping their agent functions).
- Produces: `POST /rationale`, request body `{items: AdjustedItem[], lines: POLine[], savings: float, total: float}` -> `RationaleResponse` JSON.

- [ ] **Step 1: Write the failing rationale-agent tests**

Create `backend/tests/test_rationale.py`:

```python
# tests/test_rationale.py
from wastewise.models import AdjustedItem, POLine
from wastewise.agents.rationale import write_rationale


def _items():
    return [
        AdjustedItem(item="cabbage", forecast=168, adjusted_qty=150,
                    reason="Rain lowers dine-in demand for cabbage sides.", live=True),
        AdjustedItem(item="chicken", forecast=210, adjusted_qty=196,
                    reason="Rain lowers dine-in demand for quick-grill chicken.", live=True),
    ]


def _lines():
    return [
        POLine(item="cabbage", qty=150, supplier="Kroger", unit_price=1.4,
              line_total=210.0, note="30% under the US retail average.", live=True),
        POLine(item="chicken", qty=196, supplier="Kroger", unit_price=1.24,
              line_total=243.2, note="38% under the US retail average.", live=True),
    ]


class _FakeLLM:
    def complete(self, system, user):
        return ("Rain softens dine-in demand across the board; sourcing beats "
                "the US retail average on both items.")


def test_write_rationale_returns_live_paragraph_on_success():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _FakeLLM())
    assert resp.live is True
    assert "Rain" in resp.paragraph


class _RaisingLLM:
    def complete(self, system, user):
        raise RuntimeError("endpoint down")


def test_write_rationale_falls_back_to_deterministic_template():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _RaisingLLM())
    assert resp.live is False
    assert "2 items" in resp.paragraph
    assert "1 supplier" in resp.paragraph  # both lines are "Kroger"
    assert "$92.00" in resp.paragraph
    assert "$453.20" in resp.paragraph


class _EmptyLLM:
    def complete(self, system, user):
        return "   "


def test_write_rationale_falls_back_when_completion_is_empty():
    resp = write_rationale(_items(), _lines(), 92.0, 453.2, _EmptyLLM())
    assert resp.live is False
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_rationale.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'wastewise.agents.rationale'`.

- [ ] **Step 3: Implement `rationale.py`**

Create `backend/wastewise/agents/rationale.py`:

```python
from wastewise.models import AdjustedItem, POLine, RationaleResponse

SYSTEM = (
    "You are a restaurant purchasing assistant. Given a list of forecast "
    "adjustments (item, reason, and the delta between recommended and "
    "adjusted quantity) and a list of sourcing decisions (item, supplier, "
    "note, savings), write ONE short paragraph (2-4 sentences) that connects "
    "the weather/holiday forecast story to the sourcing trade-off story into "
    "a coherent purchasing rationale a restaurant manager could read before "
    "approving the order. Respond with plain text only, no headers or lists. "
    "Reply in English."
)


def _fallback_paragraph(items: list[AdjustedItem], lines: list[POLine],
                        savings: float, total: float) -> str:
    n = len(items)
    suppliers = {l.supplier for l in lines}
    m = len(suppliers)
    item_word = "item" if n == 1 else "items"
    supplier_word = "supplier" if m == 1 else "suppliers"
    return (f"{n} {item_word} were adjusted for weather and holiday signals; "
            f"sourcing across {m} {supplier_word} saves ${savings:.2f} "
            f"versus benchmark pricing on a ${total:.2f} order.")


def write_rationale(items: list[AdjustedItem], lines: list[POLine],
                    savings: float, total: float, llm) -> RationaleResponse:
    adj_txt = "\n".join(
        f"- {i.item}: adjusted {i.forecast:.1f} -> {i.adjusted_qty:.1f} ({i.reason})"
        for i in items)
    src_txt = "\n".join(
        f"- {l.item}: {l.supplier} @ ${l.unit_price:.2f} ({l.note})"
        for l in lines)
    user = (f"Forecast adjustments:\n{adj_txt}\n\nSourcing decisions:\n{src_txt}\n\n"
            f"Total: ${total:.2f}. Savings: ${savings:.2f}.")
    try:
        paragraph = llm.complete(SYSTEM, user).strip()
        if not paragraph:
            raise ValueError("empty completion")
        return RationaleResponse(paragraph=paragraph, live=True)
    except Exception:
        return RationaleResponse(
            paragraph=_fallback_paragraph(items, lines, savings, total), live=False)
```

- [ ] **Step 4: Run the new test file to verify it passes**

Run: `cd backend && python -m pytest tests/test_rationale.py -v`
Expected: `3 passed`.

- [ ] **Step 5: Write the failing pipeline test**

Add to `backend/tests/test_pipeline.py`:

```python
from wastewise.models import AdjustedItem, POLine
from wastewise.pipeline import run_rationale


def test_run_rationale_wraps_write_rationale():
    items = [AdjustedItem(item="cabbage", forecast=100, adjusted_qty=90,
                          reason="Rain lowers demand.", live=True)]
    lines = [POLine(item="cabbage", qty=90, supplier="Kroger", unit_price=1.4,
                    line_total=126.0, note="30% under benchmark.", live=True)]
    resp = run_rationale(items, lines, 10.0, 126.0, _LLM())
    assert resp.live is True
    assert resp.paragraph == "note"  # _LLM.complete always returns "note"
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_pipeline.py -v -k rationale`
Expected: FAIL — `ImportError: cannot import name 'run_rationale'`.

- [ ] **Step 7: Wire `run_rationale` into `pipeline.py`**

In `backend/wastewise/pipeline.py`, change the imports:

```python
from wastewise.models import ForecastResponse, SourcingResponse, SalesRecord
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
```

to:

```python
from wastewise.models import ForecastResponse, SourcingResponse, RationaleResponse, SalesRecord, AdjustedItem, POLine
from wastewise.forecasting.forecaster import forecast_items
from wastewise.agents.adjustment import adjust_forecast
from wastewise.agents.sourcing import source_order
from wastewise.agents.rationale import write_rationale
```

Add at the end of the file:

```python
def run_rationale(items: list[AdjustedItem], lines: list[POLine], savings: float,
                  total: float, llm) -> RationaleResponse:
    return write_rationale(items, lines, savings, total, llm)
```

- [ ] **Step 8: Run the pipeline tests**

Run: `cd backend && python -m pytest tests/test_pipeline.py -v`
Expected: `3 passed` (2 pre-existing + 1 new).

- [ ] **Step 9: Write the failing API test**

Add to `backend/tests/test_api.py`:

```python
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
```

Also add `"live": True` to the two `SourcingRequest`-adjacent JSON bodies already present in `test_upload_then_forecast_then_sourcing` — check first whether that test posts raw item dicts (`{"item": ..., "qty": ...}`, which don't include `live` since `SourcingItem` doesn't have that field) rather than full `POLine`/`AdjustedItem` bodies; if so, no change is needed there. (It does post raw `SourcingItem` dicts, not `POLine`, so nothing to change.)

- [ ] **Step 10: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_api.py -v -k rationale`
Expected: FAIL — `404 Not Found` (no `/rationale` route yet).

- [ ] **Step 11: Wire the endpoint into `api.py`**

In `backend/wastewise/api.py`, change the import:

```python
from wastewise.pipeline import run_forecast, run_sourcing
```

to:

```python
from wastewise.pipeline import run_forecast, run_sourcing, run_rationale
from wastewise.models import AdjustedItem, POLine
```

Add after the `SourcingRequest` class:

```python
class RationaleRequest(BaseModel):
    items: list[AdjustedItem]
    lines: list[POLine]
    savings: float
    total: float
```

Add after the `/sourcing` route:

```python
@app.post("/rationale")
def rationale(req: RationaleRequest, deps: dict = Depends(get_deps)):
    return run_rationale(req.items, req.lines, req.savings, req.total, deps["llm"])
```

- [ ] **Step 12: Run the API tests**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: all pass.

- [ ] **Step 13: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass, 0 failures. This is the first point since Task 1 where the whole backend suite is green again.

- [ ] **Step 14: Commit**

```bash
git add backend/wastewise/agents/rationale.py backend/tests/test_rationale.py \
        backend/wastewise/pipeline.py backend/tests/test_pipeline.py \
        backend/wastewise/api.py backend/tests/test_api.py
git commit -m "feat: add rationale agent, pipeline wiring, and POST /rationale endpoint"
```

---

### Task 5: Frontend — types, API client, and demo fixtures

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/demo.ts`

**Interfaces:**
- Modifies: `ForecastAdjustedItem` gains `live: boolean`.
- Modifies: `POLine` gains `live: boolean`.
- Produces: `RationaleResponse { paragraph: string; live: boolean }`.
- Produces: `runRationale(items: ForecastAdjustedItem[], lines: POLine[], savings: number, total: number): Promise<RationaleResponse>` — consumed by Task 8's Order page.
- Produces: `DEMO_RATIONALE: RationaleResponse` — consumed by Task 8's tests and `api.ts`'s demo fallback.

- [ ] **Step 1: Update `types.ts`**

In `frontend/lib/types.ts`, change:

```typescript
export interface ForecastAdjustedItem {
  item: string;
  forecast: number;
  adjusted_qty: number;
  reason: string;
}
```

to:

```typescript
export interface ForecastAdjustedItem {
  item: string;
  forecast: number;
  adjusted_qty: number;
  reason: string;
  live: boolean;
}
```

Change:

```typescript
export interface POLine {
  item: string;
  qty: number;
  supplier: string;
  unit_price: number;
  line_total: number;
  note: string;
}
```

to:

```typescript
export interface POLine {
  item: string;
  qty: number;
  supplier: string;
  unit_price: number;
  line_total: number;
  note: string;
  live: boolean;
}
```

Add at the end of the file:

```typescript
export interface RationaleResponse {
  paragraph: string;
  live: boolean;
}
```

- [ ] **Step 2: Update `demo.ts` to fix the differentiation bug and add `live`/rationale fixtures**

Replace the full contents of `frontend/lib/demo.ts`:

```typescript
import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse } from "./types";

export const DEMO_UPLOAD: UploadResponse = {
  dataset_id: "demo",
  summary: {
    dataset_id: "demo",
    n_rows: 270,
    items: ["cabbage", "chicken", "pork"],
    start_date: "2026-04-01",
    end_date: "2026-06-29",
  },
};

export const DEMO_FORECAST: ForecastResponse = {
  baseline_delta: 0.18,
  items: [
    { item: "cabbage", forecast: 168.0, adjusted_qty: 150.0, live: true,
      reason: "Rain forecast lowers dine-in demand for fresh-cut sides like cabbage slaw." },
    { item: "pork", forecast: 126.0, adjusted_qty: 118.0, live: true,
      reason: "Rain dampens dine-in traffic, but pork's use in stews softens the drop." },
    { item: "chicken", forecast: 210.0, adjusted_qty: 196.0, live: true,
      reason: "Rain lowers dine-in demand most for quick-grill items like chicken." },
  ],
};

export const DEMO_SOURCING: SourcingResponse = {
  total: 618.4,
  savings: 92.0,
  lines: [
    { item: "cabbage", qty: 150, supplier: "Kroger", unit_price: 1.4, line_total: 210.0, live: true, note: "30% under the US retail average." },
    { item: "pork", qty: 118, supplier: "Kroger", unit_price: 1.4, line_total: 165.2, live: true, note: "30% under the US retail average." },
    { item: "chicken", qty: 196, supplier: "Kroger", unit_price: 1.24, line_total: 243.2, live: true, note: "38% under the US retail average." },
  ],
};

export const DEMO_RATIONALE: RationaleResponse = {
  paragraph:
    "This week's rain forecast lowers dine-in traffic across the board, though " +
    "pork's role in stews softens its drop compared to lighter fare like chicken " +
    "and cabbage sides. Sourcing found Kroger listings for all three items " +
    "running 30-38% under the US retail average, saving $92.00 on a $618.40 order.",
  live: true,
};

const DEMO_KEY = "ww_demo";

export function setDemoMode(on: boolean): void {
  if (typeof window === "undefined") return;
  if (on) window.sessionStorage.setItem(DEMO_KEY, "1");
  else window.sessionStorage.removeItem(DEMO_KEY);
}

export function isDemoMode(): boolean {
  const forced = typeof window !== "undefined" && window.sessionStorage.getItem(DEMO_KEY) === "1";
  const noBackend = !process.env.NEXT_PUBLIC_API_URL;
  return forced || noBackend;
}
```

- [ ] **Step 3: Add `runRationale` to `api.ts`**

In `frontend/lib/api.ts`, change the import:

```typescript
import type { UploadResponse, ForecastResponse, SourcingResponse, Horizon } from "./types";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, isDemoMode } from "./demo";
```

to:

```typescript
import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse, ForecastAdjustedItem, POLine, Horizon } from "./types";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE, isDemoMode } from "./demo";
```

Add at the end of the file:

```typescript
export function runRationale(
  items: ForecastAdjustedItem[],
  lines: POLine[],
  savings: number,
  total: number,
): Promise<RationaleResponse> {
  return call("/rationale", jsonInit({ items, lines, savings, total }), DEMO_RATIONALE);
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: fails at this point — `reason-badge.tsx`, `price-table.tsx`, `forecast/page.tsx`, `order/page.tsx`, and the test files constructing `POLine`/`ForecastAdjustedItem` literals don't set `live` yet, and `ReasonBadge`'s prop type doesn't match. This is expected; Tasks 6–8 fix each. Confirm the errors are only in those files, not new ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts frontend/lib/demo.ts
git commit -m "feat: add live flag to frontend types, runRationale client, and fix demo data differentiation"
```

---

### Task 6: Frontend — `ReasonBadge` branches on `live`, mobile row, Forecast page wiring

**Files:**
- Modify: `frontend/components/reason-badge.tsx`
- Modify: `frontend/app/forecast/page.tsx`
- Modify: `frontend/__tests__/forecast.test.tsx`
- Create: `frontend/__tests__/reason-badge.test.tsx`

**Interfaces:**
- Modifies: `ReasonBadge({ reason, live }: { reason: string; live: boolean })` — branches on `live` instead of string-matching `"No adjustment applied."`.

- [ ] **Step 1: Write the failing `ReasonBadge` tests**

Create `frontend/__tests__/reason-badge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReasonBadge } from "@/components/reason-badge";

describe("ReasonBadge", () => {
  it("renders the live AI badge with the reason when live", () => {
    render(<ReasonBadge reason="Rain drives comfort-food orders up." live={true} />);
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Rain drives comfort-food orders up.")).toBeInTheDocument();
  });

  it("renders a visually distinct unavailable state when not live, without the AI chip", () => {
    render(<ReasonBadge reason="AI reasoning unavailable — using base forecast." live={false} />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run __tests__/reason-badge.test.tsx`
Expected: FAIL — `ReasonBadge` doesn't accept a `live` prop yet and still string-sniffs `reason`.

- [ ] **Step 3: Rewrite `reason-badge.tsx`**

Replace the full contents of `frontend/components/reason-badge.tsx`:

```tsx
export function ReasonBadge({ reason, live }: { reason: string; live: boolean }) {
  if (!live) {
    return (
      <span className="flex max-w-full items-start gap-2 border-l-2 border-dashed border-muted-foreground/40 pl-2 text-left text-xs italic leading-snug text-muted-foreground">
        {reason}
      </span>
    );
  }
  return (
    <span className="flex max-w-full items-start gap-2 border-l-2 border-accent pl-2 text-left text-sm font-medium leading-snug">
      <span className="ww-label text-accent">AI</span>
      <span className="text-foreground">{reason}</span>
    </span>
  );
}
```

- [ ] **Step 4: Run the `ReasonBadge` tests**

Run: `cd frontend && npx vitest run __tests__/reason-badge.test.tsx`
Expected: `2 passed`.

- [ ] **Step 5: Wire `live` through the Forecast page + add the mobile-only row**

In `frontend/app/forecast/page.tsx`, add `Fragment` to the React import:

```tsx
import { Fragment, useEffect, useRef, useState } from "react";
```

Then replace the `<thead>`/`<tbody>` block:

```tsx
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
```

with:

```tsx
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
                      <Fragment key={it.item}>
                        <tr className={idx > 0 ? "border-t border-dashed border-foreground/15" : ""}>
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
                            <ReasonBadge reason={it.reason} live={it.live} />
                          </td>
                        </tr>
                        <tr className="sm:hidden">
                          <td colSpan={4} className="px-4 pb-3">
                            <ReasonBadge reason={it.reason} live={it.live} />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
```

Note: a `<tbody>` cannot itself contain another `<tbody>` — that's invalid HTML, and since this page is server-rendered, the browser's HTML parser would restructure a nested `<tbody>` while parsing the initial markup, which would not match what React expects to find and would throw a hydration-mismatch error. Grouping "row + its mobile-only row" as one `.map()` iteration without introducing any extra DOM node requires React's `Fragment` (with an explicit `key`, which the `<>...</>` shorthand doesn't support) — that's why `Fragment` is imported explicitly above instead of using the shorthand. There is still exactly one `<tbody>` in the rendered output; only the `<tr>` count doubles per item.

- [ ] **Step 6: Rewrite the forecast reason assertions in `forecast.test.tsx`**

In `frontend/__tests__/forecast.test.tsx`, change:

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

to:

```typescript
  it("renders adjusted items with genuinely different per-item reasons after forecasting", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("cabbage")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText(/fresh-cut sides like cabbage slaw/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/pork's use in stews softens the drop/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/quick-grill items like chicken/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/18%/)).toBeInTheDocument(); // baseline_delta 0.18 -> "18%"
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /model/i })).toBeInTheDocument();
  });
```

- [ ] **Step 7: Run the forecast test file**

Run: `cd frontend && npx vitest run __tests__/forecast.test.tsx`
Expected: `4 passed`.

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors referencing `reason-badge.tsx` or `forecast/page.tsx` anymore; remaining errors (if any) are in files fixed by Tasks 7–8.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/reason-badge.tsx frontend/app/forecast/page.tsx \
        frontend/__tests__/forecast.test.tsx frontend/__tests__/reason-badge.test.tsx
git commit -m "feat: ReasonBadge branches on live flag, bumped size, always-visible mobile row"
```

---

### Task 7: Frontend — `PriceTable` note column surfaces the LLM's selection reasoning

**Files:**
- Modify: `frontend/components/price-table.tsx`
- Modify: `frontend/__tests__/sourcing.test.tsx`

**Interfaces:**
- Consumes: `POLine.live` from Task 5.
- Modifies: `PriceTable`'s note `<td>` — renders an "AI picked this" accent label + the LLM's reasoning when `line.live` is true; otherwise unchanged plain muted note. `SupplierCell`'s existing "No live offer"/`Market` logic is untouched (stays orthogonal to `live`, per spec).

- [ ] **Step 1: Write the failing test**

In `frontend/__tests__/sourcing.test.tsx`, add:

```tsx
  it("labels a live LLM selection note with an 'AI picked this' framing", async () => {
    vi.spyOn(api, "runSourcing").mockResolvedValue(DEMO_SOURCING);
    renderWithWizard(<SourcingPage />, { initial: { datasetId: "demo", forecast: DEMO_FORECAST } });
    const table = await screen.findByRole("table");
    // DEMO_SOURCING's three lines are all live: true (fixed in Task 5)
    expect(within(table).getAllByText(/AI picked this/i)).toHaveLength(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run __tests__/sourcing.test.tsx`
Expected: FAIL — `PriceTable` doesn't render "AI picked this" text yet.

- [ ] **Step 3: Update `price-table.tsx`**

In `frontend/components/price-table.tsx`, add a new component after `noteText()` and use it in place of the inline note rendering. Change:

```tsx
function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using the US retail average as reference.";
  return line.note;
}
```

to:

```tsx
function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using the US retail average as reference.";
  return line.note;
}

function NoteCell({ line }: { line: POLine }) {
  const text = noteText(line);
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

Then change the note `<td>` in the table body:

```tsx
              <td className="px-4 py-3 text-[11px] text-muted-foreground">{noteText(l)}</td>
```

to:

```tsx
              <td className="px-4 py-3">
                <NoteCell line={l} />
              </td>
```

- [ ] **Step 4: Run the sourcing test file**

Run: `cd frontend && npx vitest run __tests__/sourcing.test.tsx`
Expected: `5 passed`.

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors in `price-table.tsx` or `sourcing.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/price-table.tsx frontend/__tests__/sourcing.test.tsx
git commit -m "feat: PriceTable surfaces live LLM selection reasoning with an 'AI picked this' label"
```

---

### Task 8: Frontend — Order page rationale card + wizard store

**Files:**
- Modify: `frontend/lib/store.tsx`
- Modify: `frontend/app/order/page.tsx`
- Modify: `frontend/__tests__/order.test.tsx`

**Interfaces:**
- Consumes: `runRationale` from Task 5.
- Modifies: `WizardState` gains `rationale: RationaleResponse | null` (default `null`), persisted/reset via the existing generic `set()` — no new dedicated setter, matching the existing `forecast`/`sourcing` pattern which also has no per-field setter.

- [ ] **Step 1: Add `rationale` to the wizard store**

In `frontend/lib/store.tsx`, change the import:

```tsx
import type { DatasetSummary, ForecastResponse, SourcingResponse, Horizon } from "./types";
```

to:

```tsx
import type { DatasetSummary, ForecastResponse, SourcingResponse, RationaleResponse, Horizon } from "./types";
```

Change:

```tsx
interface WizardState {
  location: string;
  horizon: Horizon;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
};
```

to:

```tsx
interface WizardState {
  location: string;
  horizon: Horizon;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
  rationale: RationaleResponse | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
  rationale: null,
};
```

- [ ] **Step 2: Write the failing Order page test**

In `frontend/__tests__/order.test.tsx`, add the import and a new test:

```tsx
import { DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE } from "@/lib/demo";
import * as api from "@/lib/api";
```

(merge with the existing `import { DEMO_SOURCING } from "@/lib/demo";` line — replace it rather than duplicating.)

Add:

```tsx
  it("fetches and renders the purchasing rationale between the header and the PO table", async () => {
    vi.spyOn(api, "runRationale").mockResolvedValue(DEMO_RATIONALE);
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING },
    });
    expect(await screen.findByText(/dine-in traffic across the board/i)).toBeInTheDocument();
    expect(screen.getByText("AI synthesis")).toBeInTheDocument();
  });

  it("never gates Approve on the rationale call", async () => {
    vi.spyOn(api, "runRationale").mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING },
    });
    const approveButton = await screen.findByRole("button", { name: /approve/i });
    expect(approveButton).not.toBeDisabled();
  });
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run __tests__/order.test.tsx`
Expected: FAIL — `runRationale` is never called by `OrderPage` yet, no "AI synthesis" text exists.

- [ ] **Step 4: Add the rationale card to `order/page.tsx`**

Replace the full contents of `frontend/app/order/page.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { runRationale } from "@/lib/api";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function OrderPage() {
  const router = useRouter();
  const { forecast, sourcing, rationale, hydrated, set } = useWizard();
  const [approved, setApproved] = useState(false);
  const [rationaleLoading, setRationaleLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!sourcing) router.push("/sourcing");
  }, [hydrated, sourcing, router]);

  useEffect(() => {
    // Rationale is a purely additive synthesis card -- never gate Approve/
    // Download on it, so a slow or failed call never blocks the page.
    if (!hydrated || !forecast || !sourcing) return;
    if (rationale || started.current) return;
    started.current = true;
    setRationaleLoading(true);
    runRationale(forecast.items, sourcing.lines, sourcing.savings, sourcing.total)
      .then((res) => set({ rationale: res }))
      .catch(() => {
        // Non-blocking: leave `rationale` null and simply don't render the
        // card's content. No inline error state -- this call never gates
        // Approve/Download per the design spec.
      })
      .finally(() => setRationaleLoading(false));
  }, [hydrated, forecast, sourcing, rationale, set]);

  if (!hydrated) return null;
  if (!sourcing)
    return <RedirectNotice target="Sourcing" reason="Pick suppliers before reviewing the purchase order." />;

  function download() {
    if (!sourcing) return;
    const blob = new Blob([poToCsv(sourcing.lines, sourcing.total)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-order.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-8">
      <Link
        href="/sourcing"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to sourcing
      </Link>

      <div>
        <p className="ww-label text-accent">§ IV &mdash; Order</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Purchase Order
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review the draft, approve, and download the CSV for your supplier.
        </p>
      </div>

      <div>
        <p className="ww-label mb-2">Purchasing rationale</p>
        <div className="border border-foreground/20 bg-card px-4 py-4">
          {rationaleLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : rationale ? (
            <div className="space-y-2">
              <span
                className={`ww-label ${rationale.live ? "text-accent" : "text-muted-foreground"}`}
              >
                {rationale.live ? "AI synthesis" : "Synthesis unavailable"}
              </span>
              <p className="text-sm leading-relaxed text-foreground">{rationale.paragraph}</p>
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">Rationale unavailable.</p>
          )}
        </div>
      </div>

      <div>
        <p className="ww-label mb-2">Tbl. 3 — Purchase order draft</p>
        <div className="border border-foreground/20 bg-card">
          <POTable lines={sourcing.lines} total={sourcing.total} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-foreground/20 pt-4">
        <Button
          onClick={() => setApproved(true)}
          disabled={approved}
          className={
            approved
              ? "bg-accent text-accent-foreground"
              : "bg-accent text-accent-foreground hover:bg-accent/85"
          }
        >
          {approved ? "Approved ✓" : "Approve"}
        </Button>
        <Button
          variant="secondary"
          onClick={download}
          className="border border-foreground/25 bg-transparent hover:bg-foreground/5"
        >
          Download CSV
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the Order page tests**

Run: `cd frontend && npx vitest run __tests__/order.test.tsx`
Expected: `4 passed` (2 pre-existing + 2 new).

- [ ] **Step 6: Full frontend suite + type-check**

Run: `cd frontend && npx vitest run`
Expected: all tests pass across every file touched in Tasks 5–8.

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/lib/store.tsx frontend/app/order/page.tsx frontend/__tests__/order.test.tsx
git commit -m "feat: Order page fetches and renders a purchasing rationale card, never gating Approve"
```

---

### Task 9: Full verification, including a real-endpoint smoke test

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass, 0 failures.

- [ ] **Step 2: Full frontend suite + type-check**

Run: `cd frontend && npx vitest run`
Expected: all tests pass.

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test the adjustment agent against the real LLM endpoint (not mocked)**

Per the spec's own risk note (§8): the per-item adjustment call must be proven live before it's trusted for a demo, not discovered failing during recording.

```bash
cd backend
uvicorn wastewise.api:app --host 127.0.0.1 --port 8099 &
sleep 3
curl -s -X POST http://127.0.0.1:8099/upload -F "file=@wastewise/data/demo_sales.csv"
```

Copy the returned `dataset_id`, then:

```bash
curl -s -X POST http://127.0.0.1:8099/forecast -H "Content-Type: application/json" \
  -d '{"dataset_id":"<paste>","horizon":"week","location":"40.7,-74.0"}'
```

Expected: each item's `"reason"` is a distinct, real sentence (not identical across items, not `"AI reasoning unavailable — using base forecast."`), and each item's `"live"` is `true`. If any item shows `"live": false`, check the `[ LLM LIVE ]`/`[ LLM DOWN ]` banner printed to stderr at server boot to diagnose before proceeding.

- [ ] **Step 4: Smoke-test the rationale endpoint against the real LLM**

Using the same running server and the forecast response's `items`, plus a `/sourcing` call's `lines`/`savings`/`total`:

```bash
curl -s -X POST http://127.0.0.1:8099/sourcing -H "Content-Type: application/json" \
  -d '{"items":[{"item":"cabbage","qty":150},{"item":"pork","qty":118},{"item":"chicken","qty":196}],"location":"40.7,-74.0"}'
```

Then paste the forecast's `items` array and this response's `lines`/`savings`/`total` into:

```bash
curl -s -X POST http://127.0.0.1:8099/rationale -H "Content-Type: application/json" \
  -d '{"items":<paste forecast items>,"lines":<paste sourcing lines>,"savings":<paste>,"total":<paste>}'
```

Expected: `"live": true` and a `"paragraph"` that reads as a real, coherent 2-4 sentence synthesis (not the deterministic template sentence). Stop the server after (`kill %1` or the equivalent for the backgrounded `uvicorn` process).

- [ ] **Step 5: Manual UI pass (dev server)**

```bash
cd frontend
npm run dev
```

Walk Setup → Forecast → Sourcing → Order in a browser. Confirm: Forecast's per-item badges are readable at the new size and visible on a narrow viewport (resize below `sm`) as a second row under each item; Sourcing's price notes show "AI picked this" for live rows; Order's rationale card appears above the PO table and Approve/Download remain clickable immediately (not blocked on the rationale card's skeleton). Stop the dev server after.

- [ ] **Step 6: Final commit (docs only, if anything needs updating)**

If `docs/STATUS.md` should be updated to reflect this work (optional — only if time allows before the deadline), update its "AI agent produces real reasons" caveat section to reference the new `live` field and rationale card, then:

```bash
git add docs/STATUS.md
git commit -m "docs: reflect AI-centered UX pass in STATUS.md"
```

Otherwise, this task ends without a commit (verification-only).

---

## Self-Review

- **Spec coverage:** §1 (adjustment.py parallelized + few-shot + `live`) → Task 2. §2 (sourcing.py `live` threaded from `_choose_offer`) → Task 3. §3 (rationale.py + `/rationale` + `RationaleResponse`) → Task 4. §4 (frontend types/api client/demo fixture fix) → Task 5. §5 (`ReasonBadge` live-branching + mobile row) → Task 6. §6 (`PriceTable` note column "AI picked this") → Task 7. §7 (Order page rationale card + store) → Task 8. §8 (backend/frontend test updates + real-endpoint smoke test before deadline) → woven into every task's own test steps plus Task 9 Steps 3–4 explicitly. Out-of-scope items (forecasting model, data adapters, unifying badge/note components, gating Approve) are called out in Global Constraints and never touched.
- **Placeholders:** none — every step has runnable code or an exact command with expected output.
- **Type/name consistency:** `AdjustedItem.live`/`POLine.live` (Task 1) flow unchanged in name and type through `adjustment.py`/`sourcing.py` (Tasks 2–3), `rationale.py`/`pipeline.py`/`api.py` (Task 4), and `types.ts`/`api.ts`/`demo.ts` (Task 5) into every component (Tasks 6–8) — verified the same `live: boolean`/`live: bool` field name is used everywhere, no `isLive`/`liveFlag` drift. `FALLBACK_REASON` (Task 2) is a Python-side constant only; the frontend never imports it, it only needs the same literal fallback text convention (also used verbatim in Task 9's smoke-test expectations). `write_rationale`/`run_rationale`/`runRationale` naming mirrors the existing `adjust_forecast`/`run_forecast`/`runForecast` and `source_order`/`run_sourcing`/`runSourcing` triads exactly.
- **Ordering dependencies:** Task 1 is a hard prerequisite for Tasks 2–8 (all of them construct or consume `AdjustedItem`/`POLine`/`RationaleResponse`). Task 4 depends on Task 1 only (not 2/3) since `rationale.py` doesn't call the adjustment/sourcing agents directly, only consumes their already-`live`-tagged output types — flagged so Tasks 2–4 could in principle be reordered, but the plan runs them in spec order (1→2→3→4) for a cleaner backend-then-frontend narrative. Task 5 (frontend types) is a hard prerequisite for Tasks 6–8. Within Task 6, the forecast page's mobile-row restructuring is a nested-`<tbody>` HTML quirk — flagged inline in Step 5 with an explicit warning to double-check indentation/tag-nesting against the actual file rather than trusting the diff blindly, since this is the one step in the plan with the highest risk of a copy-paste seam.
