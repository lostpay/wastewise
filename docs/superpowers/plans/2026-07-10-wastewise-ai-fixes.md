# WasteWise AI/Sourcing Fix + AMD-Compute-Maximization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed root causes making `/forecast` and `/sourcing` silently non-functional (dead LLM, dead USDA credential, naive/dishonest retail pricing), and make the two agent steps do genuinely more AMD-hosted LLM reasoning per request instead of one throwaway completion each.

**Architecture:** No new services. Fixes land in the existing `backend/wastewise` package: config defaults, one new standalone diagnostic script (mirrors the existing `check_llm.py` pattern), and a rework of `agents/sourcing.py` so the LLM actually *chooses* between multiple real retail candidates and explains the choice, instead of rubber-stamping whatever Kroger's search happened to rank first.

**Tech Stack:** Python 3.10, FastAPI, pytest, httpx, respx (HTTP mocking), the existing `openai`-compatible `LLMClient`.

## Global Constraints

- Every LLM-facing prompt must produce output that is schema-validated (JSON where structured) with a deterministic fallback on any parse/validation failure — this is the existing house style (see `agents/adjustment.py`), do not deviate from it.
- All LLM output must remain in English (existing hard requirement, already enforced via system prompts — do not remove).
- Do not touch `agents/adjustment.py` logic — it was proven correct in root-cause investigation; it was only ever failing because the LLM endpoint was dead (Task 1 fixes that).
- Do not attempt a GPU-trained forecasting model (PyTorch/XGBoost-on-ROCm) in this plan — that's an explicit v2/roadmap item and too large a change this close to the July 11, 2026 15:00 UTC deadline. Out of scope here.
- Do not build a bespoke non-US retail/wholesale API integration (e.g. a real India-specific adapter) in this plan — Task 8 covers the non-US case via a market-agnostic historical-price fallback instead, which needs no new credentials or scraping.
- Do not implement live web scraping for pricing — fragile, ToS/legal risk, and conflicts with the design spec's own "the demo must not break" rule. If ever added, it must be pre-scraped and statically cached, never scraped live during a demo. Out of scope here.
- Every task must leave `pytest -q` fully green (currently 45 passed) before moving to the next task.

---

### Task 1: Fix the broken default LLM — switch dev to local Ollama running the same Mistral model as the AMD box

**Context:** Root-cause investigation confirmed the shipped default `LLM_MODEL=accounts/fireworks/models/llama-v3p1-8b-instruct` returns `404 Model not found, inaccessible, and/or not deployed` from Fireworks — this is why **every** `/forecast` and `/sourcing` call falls back to deterministic placeholders, 100% of the time, regardless of dataset. Rather than pin dev to a different model family on Fireworks, dev now runs **Ollama locally with the same `mistralai/Mistral-7B-Instruct-v0.3`-family model the AMD box serves via vLLM** (`docs/AMD_RUNBOOK.md` step 3), so model-specific behavior (JSON formatting, instruction-following) is caught locally before the live AMD demo, not during it. Verified live: `ollama pull mistral` fetches a 7.2B-parameter model (matches Mistral-7B), and its OpenAI-compatible endpoint at `http://localhost:11434/v1` already works unmodified with the existing `LLMClient` — a direct `POST /v1/chat/completions` with `{"model": "mistral", ...}` returned a normal completion. No code changes to `agents/llm.py` are needed, only config.

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/.env` (local file, gitignored — apply the same fix so local dev actually works)

**Interfaces:** None (config only, no code signatures change).

- [ ] **Step 1: Make sure Ollama is running with the model pulled (one-time local setup)**

```bash
ollama serve &        # skip if already running (check with: ollama list)
ollama pull mistral   # ~4.4 GB, one-time; confirms with `ollama list` afterward
```
Expected: `ollama list` shows `mistral:latest`.

- [ ] **Step 2: Update the example env file**

In `backend/.env.example`, change:
```
LLM_BASE_URL=https://api.fireworks.ai/inference/v1
LLM_API_KEY=changeme
LLM_MODEL=accounts/fireworks/models/llama-v3p1-8b-instruct
```
to:
```
# Dev default: local Ollama running the same Mistral model family as the AMD
# box (docs/AMD_RUNBOOK.md), so model-specific quirks are caught before the
# live demo. Requires `ollama serve` + `ollama pull mistral` running locally.
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=mistral
```

- [ ] **Step 3: Apply the same fix to the local `.env`**

Edit `backend/.env` and set the same three values as Step 2.

- [ ] **Step 4: Verify with the existing standalone LLM check**

Run:
```bash
cd backend
python -m wastewise.check_llm
```
Expected: exit code `0` and a `[ LLM LIVE ]` banner (not `[ LLM DOWN ]`), e.g.:
```
  [ LLM LIVE ]  real inference IS being used
    endpoint : http://localhost:11434/v1
    model    : mistral
```

- [ ] **Step 4: Verify end-to-end through the API**

```bash
uvicorn wastewise.api:app --host 127.0.0.1 --port 8099 &
sleep 3
curl -s -X POST http://127.0.0.1:8099/upload -F "file=@wastewise/data/demo_sales.csv"
```
Copy the returned `dataset_id`, then:
```bash
curl -s -X POST http://127.0.0.1:8099/forecast -H "Content-Type: application/json" \
  -d '{"dataset_id":"<paste>","horizon":"week","location":"40.7,-74.0"}'
```
Expected: at least one item's `"reason"` is a real generated sentence (not the literal string `"No adjustment applied."`). Then stop the server.

- [ ] **Step 6: Commit**

```bash
git add backend/.env.example
git commit -m "fix: switch dev LLM default to local Ollama running the AMD box's Mistral model"
```
(`.env` is gitignored — no commit needed for that file, but keep the local edit.)

---

### Task 2: Add a standalone data-source diagnostic (catch silent credential failures loudly)

**Context:** The USDA wholesale adapter's API key returns `401 User is not found` on every call (confirmed via direct HTTP probe bypassing the wrapper) — but `USDAWholesale.get_wholesale_price()` catches `httpx.HTTPError` and returns `None`, so this has been failing **silently** on every request since it was configured. There is no way to notice this short of manually calling the raw API, which is how it was found. `wastewise/check_llm.py` already solves exactly this class of problem for the LLM endpoint (`python -m wastewise.check_llm`, exits 1 on failure, prints a loud banner). Extend the same pattern to USDA and Kroger so a bad credential is caught in one command before a demo, not discovered mid-request.

**Files:**
- Create: `backend/wastewise/check_data_sources.py`
- Create: `backend/tests/test_check_data_sources.py`

**Interfaces:**
- Produces: `check_data_sources.main() -> int` (0 = all sources reachable, 1 = at least one failed), callable via `python -m wastewise.check_data_sources`.
- Consumes: `wastewise.config.get_settings()`, `wastewise.adapters.price_usda.USDAWholesale`, `wastewise.adapters.price_kroger.KrogerRetail`, `wastewise.adapters.base.FileCache`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_check_data_sources.py
from wastewise.check_data_sources import check_sources, SourceStatus


class _OkWholesale:
    def get_wholesale_price(self, item):
        return 2.0


class _DeadWholesale:
    def get_wholesale_price(self, item):
        return None


class _OkRetail:
    def get_retail_prices(self, item, location):
        return [object()]


class _DeadRetail:
    def get_retail_prices(self, item, location):
        return []


def test_check_sources_all_live():
    statuses = check_sources(_OkWholesale(), _OkRetail())
    assert all(s.live for s in statuses)


def test_check_sources_flags_dead_wholesale():
    statuses = check_sources(_DeadWholesale(), _OkRetail())
    by_name = {s.name: s for s in statuses}
    assert by_name["usda"].live is False
    assert by_name["kroger"].live is True


def test_check_sources_flags_dead_retail():
    statuses = check_sources(_OkWholesale(), _DeadRetail())
    by_name = {s.name: s for s in statuses}
    assert by_name["kroger"].live is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_check_data_sources.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wastewise.check_data_sources'`

- [ ] **Step 3: Implement the diagnostic module**

```python
# backend/wastewise/check_data_sources.py
"""Standalone data-source connectivity smoke test.

Probes USDA (wholesale benchmark) and Kroger (retail prices) with a
known-common item ("chicken") to prove whether each adapter's credentials
actually work -- as opposed to `sourcing.source_order` silently treating a
dead credential the same as "no benchmark available":

    python -m wastewise.check_data_sources

Exits 0 if both sources answered, 1 if either is down (handy for CI / demo
prep, same convention as `check_llm.py`).
"""
import sys
from dataclasses import dataclass

_PROBE_ITEM = "chicken"
_PROBE_LOCATION = "40.7,-74.0"


@dataclass
class SourceStatus:
    name: str
    live: bool
    detail: str


def check_sources(wholesale, retail) -> list[SourceStatus]:
    statuses = []

    try:
        price = wholesale.get_wholesale_price(_PROBE_ITEM)
        statuses.append(SourceStatus(
            "usda", price is not None,
            f"price={price}" if price is not None
            else "no price returned (bad credential or no match)"))
    except Exception as e:  # transport, auth, etc.
        statuses.append(SourceStatus("usda", False, f"{type(e).__name__}: {e}"))

    try:
        offers = retail.get_retail_prices(_PROBE_ITEM, _PROBE_LOCATION)
        statuses.append(SourceStatus(
            "kroger", bool(offers),
            f"{len(offers)} offer(s)" if offers
            else "no offers returned (bad credential or no match)"))
    except Exception as e:
        statuses.append(SourceStatus("kroger", False, f"{type(e).__name__}: {e}"))

    return statuses


def format_report(statuses: list[SourceStatus]) -> str:
    bar = "=" * 70
    lines = [bar]
    for s in statuses:
        tag = "[ LIVE ]" if s.live else "[ DOWN ]"
        lines.append(f"  {tag} {s.name:<8} {s.detail}")
    lines.append(bar)
    return "\n".join(lines)


def main() -> int:
    from wastewise.config import get_settings
    from wastewise.adapters.base import FileCache
    from wastewise.adapters.price_usda import USDAWholesale
    from wastewise.adapters.price_kroger import KrogerRetail

    s = get_settings()
    cache = FileCache(s.cache_dir)
    wholesale = USDAWholesale(s.usda_api_key, cache)
    retail = KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache)

    statuses = check_sources(wholesale, retail)
    print(format_report(statuses), file=sys.stderr)
    return 0 if all(s.live for s in statuses) else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_check_data_sources.py -v`
Expected: `3 passed`

- [ ] **Step 5: Run it for real to confirm the USDA finding**

```bash
cd backend
python -m wastewise.check_data_sources
```
Expected: `[ DOWN ] usda ...` (confirms the dead credential), `[ LIVE ] kroger ...`. Exit code `1`.

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/check_data_sources.py backend/tests/test_check_data_sources.py
git commit -m "feat: add standalone USDA/Kroger connectivity check"
```

---

### Task 3: Add `description` to `SupplierPrice` + fix sourcing's honesty bugs

**Context:** Two confirmed bugs in `agents/sourcing.py`: (1) when USDA returns no benchmark (always true right now, per Task 2), the note still claims `"At or above market benchmark."` — false, there is no benchmark to compare against. (2) When there are **no retail offers and no benchmark** (e.g. "Mutton" from the user's test CSV against Kroger), the line silently prices at `$0.00` with that same misleading note, rather than an honest "no price data" state. This task fixes both without changing the already-correct "no retail offers but a benchmark exists" fallback (covered by an existing passing test — must not regress).

**Files:**
- Modify: `backend/wastewise/models.py`
- Modify: `backend/wastewise/agents/sourcing.py`
- Modify: `backend/tests/test_sourcing.py`

**Interfaces:**
- Produces: `SupplierPrice.description: str` (default `""`) — consumed by Task 4/5.
- Produces: `sourcing.NO_BENCHMARK_NOTE`, `sourcing.NO_MATCH_NOTE` constants — consumed by Task 5's tests.

- [ ] **Step 1: Add the `description` field**

In `backend/wastewise/models.py`, change:
```python
class SupplierPrice(BaseModel):
    supplier: str
    unit_price: float
```
to:
```python
class SupplierPrice(BaseModel):
    supplier: str
    unit_price: float
    description: str = ""
```

- [ ] **Step 2: Write the failing tests for honest no-data states**

Add to `backend/tests/test_sourcing.py`:
```python
from wastewise.agents.sourcing import NO_BENCHMARK_NOTE, NO_MATCH_NOTE


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


def test_source_order_still_falls_back_to_market_when_benchmark_exists():
    # Regression guard: no retail offers but a real benchmark still prices
    # at the benchmark, not $0 -- this behavior must not change.
    resp = source_order([{"item": "cabbage", "qty": 4}],
                        _Wholesale(), _NoRetail(), _FakeLLM(), "loc")
    assert resp.lines[0].supplier == "Market"
    assert resp.lines[0].unit_price == 2.0
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v`
Expected: `test_source_order_no_benchmark_note_is_honest_not_misleading` and `test_source_order_no_retail_and_no_benchmark_is_honest_zero` FAIL (`ImportError` for `NO_BENCHMARK_NOTE`/`NO_MATCH_NOTE`, or wrong note/supplier text). The regression-guard test should currently PASS (behavior already exists) — confirm it does before changing code.

- [ ] **Step 4: Rewrite `sourcing.py` honesty logic**

Replace the full contents of `backend/wastewise/agents/sourcing.py` with:
```python
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse

SYSTEM = ("You write one short English sentence explaining how a chosen supplier "
          "price compares to the market benchmark. Respond with plain text only.")

NO_BENCHMARK_NOTE = "No market benchmark available for comparison."
NO_MATCH_NOTE = "No retail listing or market benchmark found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"{pct}% under market benchmark."
    return "At or above market benchmark."


def _note(llm, item: str, unit_price: float, benchmark: float | None) -> str:
    try:
        return llm.complete(
            SYSTEM,
            f"Item {item}: chosen price {unit_price}, benchmark {benchmark}.").strip()
    except Exception:
        return _fallback_note(unit_price, benchmark)


def source_order(items: list[dict], wholesale, retail, llm,
                 location: str) -> SourcingResponse:
    total = 0.0
    savings = 0.0
    prepared = []
    for entry in items:
        item, qty = entry["item"], float(entry["qty"])
        benchmark = wholesale.get_wholesale_price(item)
        offers = retail.get_retail_prices(item, location)
        if offers:
            best = min(offers, key=lambda p: p.unit_price)
            supplier, unit_price = best.supplier, best.unit_price
        elif benchmark is not None:
            supplier, unit_price = "Market", benchmark
        else:
            supplier, unit_price = "No price data", 0.0
        line_total = round(unit_price * qty, 2)
        total += line_total
        if benchmark is not None and unit_price < benchmark:
            savings += (benchmark - unit_price) * qty
        prepared.append((item, qty, supplier, unit_price, line_total, benchmark, bool(offers)))

    def _note_for(p):
        item, qty, supplier, unit_price, line_total, benchmark, has_offer = p
        if not has_offer and benchmark is None:
            return NO_MATCH_NOTE
        return _note(llm, item, unit_price, benchmark)

    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        notes = list(pool.map(_note_for, prepared))

    lines = [
        POLine(item=item, qty=qty, supplier=supplier, unit_price=unit_price,
              line_total=line_total, note=note)
        for (item, qty, supplier, unit_price, line_total, benchmark, has_offer), note
        in zip(prepared, notes)
    ]
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
```

- [ ] **Step 5: Run the full sourcing test file**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v`
Expected: all tests pass, including the 3 new ones and the pre-existing 2.

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: `48 passed` (45 existing + 3 new from this task; Task 2 added 3 more separately — run this after both tasks land, count will be 51).

- [ ] **Step 7: Commit**

```bash
git add backend/wastewise/models.py backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "fix: stop sourcing notes from claiming a benchmark that doesn't exist"
```

---

### Task 4: Fetch multiple Kroger candidates instead of blindly trusting the top match

**Context:** `KrogerRetail.get_retail_prices` requests `filter.limit: 1` — a single result, no comparison. Confirmed live: for "pork" the top (and only) match was a $10 "Bone-In Pork Loin Chops"-adjacent specialty cut, while a plainer $5 option existed one position down in Kroger's own ranking and was never even fetched. This task fetches several candidates with their descriptions so Task 5 can pick a sensible one instead of whatever Kroger's bare-keyword search ranks first.

**Files:**
- Modify: `backend/wastewise/adapters/price_kroger.py`
- Modify: `backend/tests/test_price_kroger.py`

**Interfaces:**
- Modifies: `KrogerRetail.get_retail_prices(item, location) -> list[SupplierPrice]` — same signature, now returns up to `MAX_CANDIDATES` offers (each with `.description`) instead of exactly 0 or 1.
- Consumed by: Task 5's `sourcing._choose_offer`.

- [ ] **Step 1: Write the failing test for multiple candidates**

Add to `backend/tests/test_price_kroger.py`:
```python
_MULTI_PRODUCTS_BODY = {"data": [
    {"description": "Private Selection Lemon Herb Chicken Thighs",
     "items": [{"price": {"regular": 10.0, "promo": 0}}]},
    {"description": "Kroger Chicken Breast",
     "items": [{"price": {"regular": 4.5, "promo": 0}}]},
]}


@respx.mock
def test_get_retail_prices_returns_multiple_candidates_with_descriptions(tmp_path):
    _mock_token()
    _mock_locations()
    products = respx.get(url__startswith=PRODUCTS).mock(
        return_value=httpx.Response(200, json=_MULTI_PRODUCTS_BODY))
    src = KrogerRetail("id", "secret", FileCache(str(tmp_path)))
    prices = src.get_retail_prices("chicken", "40.7,-74.0")
    assert len(prices) == 2
    assert prices[1].unit_price == 4.5
    assert prices[1].description == "Kroger Chicken Breast"
    assert products.calls.last.request.url.params["filter.limit"] == "5"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_price_kroger.py -v`
Expected: FAIL (only 1 candidate returned today; `filter.limit` currently sent as `"1"`).

- [ ] **Step 3: Update `price_kroger.py` to fetch and parse multiple candidates**

In `backend/wastewise/adapters/price_kroger.py`, add a module constant near the top (after `DEFAULT_LOCATION_ID`):
```python
MAX_CANDIDATES = 5
```

Replace the `get_retail_prices` method body and `_first_price` staticmethod with:
```python
    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        key = f"kroger/{item.lower()}/{location}"
        cached = self.cache.get(key)
        if cached is not None:
            return [SupplierPrice(**p) for p in cached["prices"]]
        try:
            location_id = self._location_id(location)
            token = self._token()
            resp = self.client.get(
                PRODUCTS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={"filter.term": item, "filter.limit": MAX_CANDIDATES,
                        "filter.locationId": location_id})
            resp.raise_for_status()
            prices = self._parse_prices(resp.json())
        except httpx.HTTPError:
            return []
        if not prices:
            return []
        self.cache.set(key, {"prices": [p.model_dump() for p in prices]})
        return prices

    def _location_id(self, location: str) -> str:
        # Kroger prices are per-store, so resolve the request's "lat,lon" to the
        # nearest store's id. Fall back to a default store when none is nearby or
        # the lookup fails, so pricing degrades to a real store instead of $0.00.
        key = f"kroger-loc/{location}"
        cached = self.cache.get(key)
        if cached is not None:
            return cached["location_id"]
        try:
            token = self._token()
            resp = self.client.get(
                LOCATIONS_URL,
                headers={"Authorization": f"Bearer {token}"},
                params={"filter.latLong.near": location, "filter.limit": 1})
            resp.raise_for_status()
            data = resp.json().get("data", [])
        except httpx.HTTPError:
            return self.default_location_id  # transient: retry next call
        loc_id = data[0].get("locationId") if data else None
        loc_id = loc_id or self.default_location_id
        self.cache.set(key, {"location_id": loc_id})
        return loc_id

    def _token(self) -> str:
        # Reuse the client-credentials token until it nears expiry so a
        # multi-item sourcing request doesn't re-authenticate per line item.
        now = time.time()
        if self._token_value is not None and now < self._token_expiry:
            return self._token_value
        resp = self.client.post(
            TOKEN_URL,
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials", "scope": "product.compact"})
        resp.raise_for_status()
        body = resp.json()
        self._token_value = body["access_token"]
        # Kroger tokens last ~30 min; refresh 60s early. Default if omitted.
        self._token_expiry = now + float(body.get("expires_in", 1800)) - 60
        return self._token_value

    @staticmethod
    def _parse_prices(payload: dict) -> list[SupplierPrice]:
        out = []
        for product in payload.get("data", []):
            items = product.get("items") or []
            if not items:
                continue
            p = items[0].get("price", {})
            val = p.get("promo") or p.get("regular")
            if not val:
                continue
            out.append(SupplierPrice(supplier="Kroger", unit_price=float(val),
                                     description=str(product.get("description") or "")))
        return out
```
(`_location_id` and `_token` are unchanged from the current file — reproduced here only because the instruction is to replace the method body region; if your editor supports a narrower diff, only `get_retail_prices` and the `_first_price` → `_parse_prices` rename actually need to change.)

- [ ] **Step 4: Run the full Kroger test file**

Run: `cd backend && python -m pytest tests/test_price_kroger.py -v`
Expected: all tests pass, including the new one. The existing single-candidate tests (`_PRODUCTS_BODY`) still pass because `_parse_prices` handles a 1-item `data` list the same way `_first_price` did.

- [ ] **Step 5: Live-confirm against the real Kroger sandbox** (optional but recommended given real credentials are configured)

```bash
cd backend
python - <<'EOF'
from wastewise.config import get_settings
from wastewise.adapters.base import FileCache
from wastewise.adapters.price_kroger import KrogerRetail

s = get_settings()
cache = FileCache(s.cache_dir + "_verify_task4")
kroger = KrogerRetail(s.kroger_client_id, s.kroger_client_secret, cache)
for offer in kroger.get_retail_prices("pork", "40.7,-74.0"):
    print(offer.description, offer.unit_price)
EOF
```
Expected: multiple lines printed (not just one), including a cheaper plain option alongside the specialty one.

- [ ] **Step 6: Commit**

```bash
git add backend/wastewise/adapters/price_kroger.py backend/tests/test_price_kroger.py
git commit -m "feat: fetch multiple Kroger candidates with descriptions instead of one blind match"
```

---

### Task 5: LLM-driven product selection — the AMD-compute-maximizing change

**Context:** This is the core "maximize AMD compute" change. Today, each sourcing call makes exactly one tiny LLM completion per item (`_note`), just to narrate a price that a dumb string match already picked. With Task 4's multiple candidates now available, replace that with a real per-item decision: the LLM sees the plain ingredient name, the wholesale benchmark, and every retail candidate's description + price, and picks which one a restaurant should actually buy in bulk (rejecting marinated/specialty SKUs in favor of the plain commodity) — then explains it in the same call. This turns each sourcing request from "one throwaway completion" into "one genuine reasoning + selection task per item," which is both more AMD GPU work and a real correctness fix (stops the agent from ever recommending a $10 marinated product over a $5 plain one). Falls back to cheapest-candidate + the Task 3 fallback note if the LLM is unavailable or returns something unusable — same resilience pattern as `agents/adjustment.py`.

**Files:**
- Modify: `backend/wastewise/agents/sourcing.py`
- Modify: `backend/tests/test_sourcing.py`

**Interfaces:**
- Produces: `sourcing._choose_offer(llm, item, offers, benchmark) -> tuple[SupplierPrice, str]` (offers is non-empty; always returns a real offer + note).
- Modifies: `source_order` to call `_choose_offer` whenever `offers` is non-empty (replacing the old "always pick `min(offers)`" line), while keeping the Task 3 "no offers" honesty branch untouched.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_sourcing.py`:
```python
import json
from wastewise.models import SupplierPrice


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


class _MalformedLLM:
    def complete(self, system, user):
        return "not json at all"


def test_source_order_falls_back_to_cheapest_when_llm_output_unusable():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _MalformedLLM(), "loc")
    line = resp.lines[0]
    assert line.unit_price == 4.5  # still the cheapest candidate
    assert "under market benchmark" in line.note


class _OutOfRangeLLM:
    def complete(self, system, user):
        return json.dumps({"index": 99, "reason": "bad index"})


def test_source_order_falls_back_when_llm_picks_out_of_range_index():
    resp = source_order([{"item": "chicken", "qty": 2}],
                        _Wholesale(), _MultiRetail(), _OutOfRangeLLM(), "loc")
    assert resp.lines[0].unit_price == 4.5
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v -k "llm_to_pick or unusable or out_of_range"`
Expected: FAIL — `source_order` currently always picks `min(offers)` regardless of the LLM, so `test_source_order_uses_llm_to_pick_best_candidate_not_just_cheapest_index0` happens to pass by coincidence (4.5 is also cheapest) but the note assertion fails since no selection call is made yet; the other two fail because there's no selection logic to fall back from.

- [ ] **Step 3: Implement `_choose_offer` and wire it into `source_order`**

Replace the full contents of `backend/wastewise/agents/sourcing.py` with:
```python
from concurrent.futures import ThreadPoolExecutor

from wastewise.models import POLine, SourcingResponse
from wastewise.agents.llm import extract_json

NOTE_SYSTEM = ("You write one short English sentence explaining how a chosen "
              "supplier price compares to the market benchmark. Respond with "
              "plain text only.")

SELECT_SYSTEM = (
    "You are a restaurant purchasing agent choosing which supplier listing to buy "
    "for a bulk kitchen order. Given a plain ingredient name, a market wholesale "
    "benchmark price (or 'none' if unavailable), and a numbered list of candidate "
    "retail listings (each with a description and unit price), pick the listing "
    "that is the plain, unprocessed commodity form of the ingredient -- not a "
    "marinated, seasoned, or specialty product -- at the best price. Respond ONLY "
    'with JSON: {"index": int, "reason": str}. "index" is the 0-based position '
    'in the candidate list. "reason" is one short English sentence explaining the '
    "choice. If the benchmark is 'none', do NOT claim or imply a benchmark "
    "comparison (e.g. never say 'under benchmark' or 'at or above benchmark') -- "
    "explain the choice in terms of the listing itself (e.g. plain cut vs. "
    "specialty, or lowest price among candidates) instead."
)

NO_BENCHMARK_NOTE = "No market benchmark available for comparison."
NO_MATCH_NOTE = "No retail listing or market benchmark found for this item."


def _fallback_note(unit_price: float, benchmark: float | None) -> str:
    if benchmark is None:
        return NO_BENCHMARK_NOTE
    if unit_price < benchmark:
        pct = round((benchmark - unit_price) / benchmark * 100)
        return f"{pct}% under market benchmark."
    return "At or above market benchmark."


def _choose_offer(llm, item: str, offers: list, benchmark: float | None):
    """Ask the LLM to pick the best candidate + explain; fall back to the
    cheapest offer with a formulaic note if the LLM is unavailable or
    returns something unusable. `offers` must be non-empty."""
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
        return offers[idx], reason
    except Exception:
        return fallback_best, _fallback_note(fallback_best.unit_price, benchmark)


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
            return None, _fallback_note(benchmark, benchmark)
        return None, NO_MATCH_NOTE

    with ThreadPoolExecutor(max_workers=min(8, len(prepared)) or 1) as pool:
        resolved = list(pool.map(_resolve, prepared))

    total = 0.0
    savings = 0.0
    lines = []
    for (item, qty, benchmark, offers), (offer, note) in zip(prepared, resolved):
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
                            unit_price=unit_price, line_total=line_total, note=note))
    return SourcingResponse(lines=lines, total=round(total, 2),
                            savings=round(savings, 2))
```

Note: `NOTE_SYSTEM` is kept only because Task 3's tests may still reference the old single-offer `_note` path conceptually — it is unused dead weight if so; if `pytest` (Step 4) shows no test references `_note` directly, delete the `NOTE_SYSTEM` constant to keep the module clean (it was folded into `SELECT_SYSTEM`).

- [ ] **Step 4: Run the full sourcing test file**

Run: `cd backend && python -m pytest tests/test_sourcing.py -v`
Expected: all tests pass (the 2 original + 3 from Task 3 + 3 from this task = 8 total). If `NOTE_SYSTEM`/`_note` are unreferenced by any test, delete them from `sourcing.py` now and re-run to confirm still green.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass (51 total: 45 original + 3 from Task 2 + 3 from Task 3's new tests + 3 from this task... exact count depends on whether Task 3's regression-guard test was newly added or already existed; treat "0 failures" as the bar, not an exact number).

- [ ] **Step 6: Live end-to-end confirmation with the real LLM + real Kroger data**

```bash
cd backend
uvicorn wastewise.api:app --host 127.0.0.1 --port 8099 &
sleep 3
curl -s -X POST http://127.0.0.1:8099/sourcing -H "Content-Type: application/json" \
  -d '{"items":[{"item":"pork","qty":10}],"location":"40.7,-74.0"}'
```
Expected: `note` is a real generated sentence (not a template string), and given the live Kroger data probed during root-cause analysis (a $10 and a $5 pork option both existed), confirm the response is no longer blindly the first/most-expensive match. Stop the server after.

- [ ] **Step 7: Commit**

```bash
git add backend/wastewise/agents/sourcing.py backend/tests/test_sourcing.py
git commit -m "feat: LLM selects the best retail candidate instead of blindly trusting the top search hit"
```

---

### Task 6: Bundle the richer test dataset as a forecast-only demo option

**Context:** The current bundled `demo_sales.csv` (3 items: cabbage/chicken/pork) is a near-perfectly deterministic weekly pattern — on it, `baseline_delta` is exactly `0.0`, making the forecasting model look broken/useless in a live demo even though it isn't. The user-provided `datasets/wastewise_sales_test.csv` (1000 rows, 10 items, realistic noise) produced a genuine `baseline_delta: 0.239` (24% improvement) when tested. Bundle it as a second demo dataset specifically for the **forecast** screen's "model beats baseline" story. Its items (Mutton, Paneer, Rohu Fish, etc.) are not US grocery items, so it is **not** wired into the sourcing demo — the existing `demo_sales.csv` (cabbage/chicken/pork) remains the sourcing demo dataset, consistent with this plan's global constraint against building a new market adapter.

**Files:**
- Create: `backend/wastewise/data/demo_sales_forecast_only.csv` (copy of `datasets/wastewise_sales_test.csv`)
- Modify: `backend/README.md`
- Modify: `frontend/README.md`

**Interfaces:** None (static asset + docs only; no new endpoint — same `/upload` handles any conforming CSV).

- [ ] **Step 1: Copy the dataset into the backend package**

```bash
cp "../datasets/wastewise_sales_test.csv" backend/wastewise/data/demo_sales_forecast_only.csv
```
(Run from the repo root, i.e. `supply and demand/`.)

- [ ] **Step 2: Verify it still parses and forecasts correctly from its new location**

```bash
cd backend
python - <<'EOF'
from wastewise.ingest import parse_sales_csv
from wastewise.forecasting.forecaster import forecast_items

text = open("wastewise/data/demo_sales_forecast_only.csv", encoding="utf-8").read()
records = parse_sales_csv(text)
items, delta = forecast_items(records, 7)
print("n_records", len(records), "n_items", len(items), "baseline_delta", delta)
assert delta > 0.15, "expected a real, visible improvement over baseline"
print("OK")
EOF
```
Expected: prints `n_records 1000 n_items 10 baseline_delta 0.239...` then `OK`.

- [ ] **Step 3: Document the two demo datasets and their intended use**

In `backend/README.md`, after the "Run locally" section, add:
```markdown
## Demo datasets
Two bundled CSVs under `wastewise/data/`:
- `demo_sales.csv` — 3 US grocery items (cabbage/chicken/pork). Use for the
  full **sourcing** demo (Kroger/USDA are US-only).
- `demo_sales_forecast_only.csv` — 10 items, realistic noise, ~1000 rows. Use
  for the **forecast** screen's "XGBoost beats baseline" story; `baseline_delta`
  is ~0.24 on this dataset vs. ~0.0 on the small demo CSV (whose pattern is too
  clean to show any model improvement). Its items are not US grocery items, so
  skip the sourcing step with this dataset.
```

In `frontend/README.md`, in the "Demo mode" section, add one line noting the same distinction:
```markdown
Two demo datasets exist on the backend: the small US-item one exercises the
full pipeline including sourcing; the larger one shows a real forecast-vs-baseline
improvement but should not be used for the sourcing step (non-US items).
```

- [ ] **Step 4: Commit**

```bash
git add backend/wastewise/data/demo_sales_forecast_only.csv backend/README.md frontend/README.md
git commit -m "docs: bundle a realistic-noise demo dataset that actually shows forecast improvement"
```

---

### Task 7: Point the documented default at AMD compute + final end-to-end verification

**Context:** Per the design spec's own compliance note, the AMD/vLLM path "must remain the production path" for the submission — but `.env.example`'s primary documented value (post-Task 1) is local Ollama, with AMD only mentioned in separate runbooks. This task makes the AMD path the explicitly documented default/primary for submission while keeping local Ollama as the clearly-labeled dev-parity fallback (already proven working from Task 1), then runs one full verification pass with `LLM_REQUIRE_LIVE=true` so a silent-fallback regression is structurally impossible to miss again.

**Files:**
- Modify: `backend/.env.example`
- Modify: `docs/AMD_USAGE.md`

**Interfaces:** None (config/docs only).

- [ ] **Step 1: Re-annotate `.env.example` to mark AMD as the submission-time primary**

In `backend/.env.example`, replace the top block with:
```
# Dev default (local Ollama, same Mistral model family as the AMD box) --
# verified working (see docs/superpowers/plans/2026-07-10-wastewise-ai-fixes.md
# Task 1). Requires `ollama serve` + `ollama pull mistral` running locally.
# For the AMD hackathon submission, POINT THIS AT THE vLLM/AMD ENDPOINT INSTEAD
# per docs/AMD_RUNBOOK.md -- that is the required production path, not this one.
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=mistral
USDA_API_KEY=changeme
KROGER_CLIENT_ID=changeme
KROGER_CLIENT_SECRET=changeme
DB_PATH=wastewise.sqlite3
CACHE_DIR=wastewise/data/cache
# Refuse to start the API unless a live LLM answers the startup ping.
# Keep false in dev; set true for the AMD/vLLM submission demo run (Task 7,
# Step 2 below) so a dead endpoint fails loudly instead of silently degrading.
LLM_REQUIRE_LIVE=false
```

- [ ] **Step 2: Add a one-line cross-reference in `docs/AMD_USAGE.md`**

At the top of `docs/AMD_USAGE.md`, immediately after the title line, add:
```markdown
> Before the final submission run: set `LLM_REQUIRE_LIVE=true` in the AMD
> box's env so the API refuses to boot on a dead vLLM endpoint instead of
> silently serving fallback text (see `backend/wastewise/config.py`). Also
> run `python -m wastewise.check_data_sources` once to confirm USDA/Kroger
> credentials are live before recording the demo video.
```

- [ ] **Step 3: Full local verification pass with the live-required gate**

```bash
cd backend
LLM_REQUIRE_LIVE=true uvicorn wastewise.api:app --host 127.0.0.1 --port 8099 &
sleep 3
curl -s http://127.0.0.1:8099/health
```
Expected: `{"status":"ok"}` — server booted successfully because Task 1's model fix makes the LLM ping live, so `LLM_REQUIRE_LIVE=true` no longer prevents startup. Stop the server.

- [ ] **Step 4: Run the complete backend test suite one final time**

```bash
cd backend
python -m pytest -q
```
Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add backend/.env.example docs/AMD_USAGE.md
git commit -m "docs: mark AMD/vLLM as the required submission-time LLM path"
```

---

### Task 8: `HistoricalPriceSource` — market-agnostic price fallback for non-US items

**Context:** Sourcing is hardcoded to US APIs (Kroger retail, USDA wholesale). Confirmed live: the user's richer test CSV (`datasets/wastewise_sales_test.csv`, bundled forecast-only in Task 6) has items like Mutton, Paneer, Rohu Fish that neither API can price — today that silently produces a `$0.00` line (the exact bug Task 3 made honest, not fixed at the source). This task adds a **fallback**, not a replacement: when the real US sources have nothing for an item, fall back to the average of that item's own historical `price` column from the uploaded dataset — real data the restaurant already provided, never fabricated, and it works for *any* market instantly with zero new credentials or scraping. US items keep using real Kroger/USDA data untouched; only items neither API can answer fall through to history. The composition uses the same `WholesaleSource`/`RetailSource` protocols already defined in `adapters/base.py`, so `agents/sourcing.py` (Tasks 3/5) needs **no changes** — the fallback is wired once, in `api.py`, before `run_sourcing` is called.

**Files:**
- Create: `backend/wastewise/adapters/price_historical.py`
- Create: `backend/tests/test_price_historical.py`
- Modify: `backend/wastewise/api.py`
- Modify: `backend/tests/test_api.py`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/sourcing/page.tsx`
- Modify: `frontend/__tests__/sourcing.test.tsx`

**Interfaces:**
- Produces: `HistoricalPriceSource(records: list[SalesRecord])` implementing both `WholesaleSource.get_wholesale_price(item) -> float | None` and `RetailSource.get_retail_prices(item, location) -> list[SupplierPrice]`.
- Produces: `FallbackWholesale(primary, secondary)` and `FallbackRetail(primary, secondary)` — thin composition wrappers satisfying the same two protocols, trying `primary` first.
- Consumes: `wastewise.models.SalesRecord` (has `.price: float | None`, already defined), `wastewise.models.SupplierPrice` (already has `.description` from Task 3).
- Modifies: `SourcingRequest` gains `dataset_id: str | None = None`; `runSourcing` (frontend) gains a third optional `datasetId` parameter (appended, so existing positional call sites and the existing test's `spy.mock.calls[0][0]` assertion on `items` are unaffected).

- [ ] **Step 1: Write the failing backend tests**

```python
# backend/tests/test_price_historical.py
import datetime
from wastewise.models import SalesRecord, SupplierPrice
from wastewise.adapters.price_historical import (
    HistoricalPriceSource, FallbackWholesale, FallbackRetail, HISTORICAL_SUPPLIER,
)


def _records():
    d = datetime.date(2026, 1, 1)
    return [
        SalesRecord(date=d, item="Mutton", quantity=2.0, price=600.0),
        SalesRecord(date=d, item="Mutton", quantity=1.8, price=620.0),
        SalesRecord(date=d, item="Rice", quantity=3.0, price=None),  # no price -> excluded
    ]


def test_historical_wholesale_price_is_average_of_recorded_prices():
    src = HistoricalPriceSource(_records())
    assert src.get_wholesale_price("mutton") == 610.0  # (600+620)/2


def test_historical_wholesale_price_none_when_item_never_priced():
    src = HistoricalPriceSource(_records())
    assert src.get_wholesale_price("rice") is None


def test_historical_retail_prices_returns_one_offer_with_description():
    src = HistoricalPriceSource(_records())
    offers = src.get_retail_prices("mutton", "any-location")
    assert len(offers) == 1
    assert offers[0].supplier == HISTORICAL_SUPPLIER
    assert offers[0].unit_price == 610.0
    assert "Mutton" in offers[0].description


class _NoDataSource:
    def get_wholesale_price(self, item): return None
    def get_retail_prices(self, item, location): return []


class _RealDataSource:
    def get_wholesale_price(self, item): return 2.0
    def get_retail_prices(self, item, location):
        return [SupplierPrice(supplier="Kroger", unit_price=1.5)]


def test_fallback_wholesale_uses_secondary_only_when_primary_has_nothing():
    historical = HistoricalPriceSource(_records())
    combo = FallbackWholesale(_NoDataSource(), historical)
    assert combo.get_wholesale_price("mutton") == 610.0


def test_fallback_wholesale_never_overrides_a_real_primary_result():
    historical = HistoricalPriceSource(_records())
    combo = FallbackWholesale(_RealDataSource(), historical)
    assert combo.get_wholesale_price("mutton") == 2.0


def test_fallback_retail_uses_secondary_only_when_primary_returns_no_offers():
    historical = HistoricalPriceSource(_records())
    combo = FallbackRetail(_NoDataSource(), historical)
    offers = combo.get_retail_prices("mutton", "loc")
    assert offers[0].supplier == HISTORICAL_SUPPLIER


def test_fallback_retail_never_overrides_real_primary_offers():
    historical = HistoricalPriceSource(_records())
    combo = FallbackRetail(_RealDataSource(), historical)
    offers = combo.get_retail_prices("mutton", "loc")
    assert offers[0].supplier == "Kroger"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_price_historical.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'wastewise.adapters.price_historical'`

- [ ] **Step 3: Implement `price_historical.py`**

```python
# backend/wastewise/adapters/price_historical.py
"""Market-agnostic price fallback derived from a dataset's own historical
`price` column.

Kroger/USDA only make sense for US grocery items. When a dataset contains
non-US items (e.g. Mutton, Paneer, Rohu Fish), those APIs return nothing, and
sourcing degrades to a silent $0.00 line. This adapter uses only data the
restaurant already provided -- never fabricated -- as a last-resort
benchmark: the historical average of that item's own `price` column.
"""
from collections import defaultdict
import statistics

from wastewise.models import SalesRecord, SupplierPrice

HISTORICAL_SUPPLIER = "Historical average"


class HistoricalPriceSource:
    def __init__(self, records: list[SalesRecord]):
        by_item: dict[str, list[float]] = defaultdict(list)
        for r in records:
            if r.price is not None:
                by_item[r.item.lower()].append(r.price)
        self._avg_price = {item: round(statistics.fmean(prices), 2)
                           for item, prices in by_item.items()}

    def get_wholesale_price(self, item: str) -> float | None:
        return self._avg_price.get(item.lower())

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        price = self._avg_price.get(item.lower())
        if price is None:
            return []
        return [SupplierPrice(
            supplier=HISTORICAL_SUPPLIER, unit_price=price,
            description=f"Average of {item}'s own historical purchase price")]


class FallbackWholesale:
    """Tries `primary` first; falls back to `secondary` only when primary
    has no answer (`None`), never overrides a real primary result."""

    def __init__(self, primary, secondary):
        self.primary, self.secondary = primary, secondary

    def get_wholesale_price(self, item: str) -> float | None:
        price = self.primary.get_wholesale_price(item)
        return price if price is not None else self.secondary.get_wholesale_price(item)


class FallbackRetail:
    def __init__(self, primary, secondary):
        self.primary, self.secondary = primary, secondary

    def get_retail_prices(self, item: str, location: str) -> list[SupplierPrice]:
        offers = self.primary.get_retail_prices(item, location)
        return offers if offers else self.secondary.get_retail_prices(item, location)
```

- [ ] **Step 4: Run the new test file to verify it passes**

Run: `cd backend && python -m pytest tests/test_price_historical.py -v`
Expected: `7 passed`

- [ ] **Step 5: Write the failing API-level tests**

Add to `backend/tests/test_api.py`:
```python
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


def test_sourcing_dataset_id_404_when_unknown(tmp_path):
    client = _client(tmp_path)
    r = client.post("/sourcing", json={"items": [{"item": "mutton", "qty": 5}],
                    "location": "40.7,-74.0", "dataset_id": "does-not-exist"})
    assert r.status_code == 404
    api.app.dependency_overrides.clear()
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd backend && python -m pytest tests/test_api.py -v -k "historical or dataset_id_404"`
Expected: FAIL — `dataset_id` is not yet an accepted `SourcingRequest` field (Pydantic will silently ignore extra fields by default rather than error, so the actual failure is `line["supplier"] == "Kroger"`/no historical fallback happens, and the 404 test fails because there's no dataset-lookup branch to 404 from).

- [ ] **Step 7: Wire the fallback into `api.py`**

In `backend/wastewise/api.py`, add to the imports:
```python
from wastewise.adapters.price_historical import (
    HistoricalPriceSource, FallbackWholesale, FallbackRetail)
```

Change the `SourcingRequest` model:
```python
class SourcingRequest(_LocatedRequest):
    items: list[SourcingItem]
    dataset_id: str | None = None
```

Replace the `/sourcing` handler:
```python
@app.post("/sourcing")
def sourcing(req: SourcingRequest, deps: dict = Depends(get_deps)):
    wholesale, retail = deps["wholesale"], deps["retail"]
    if req.dataset_id:
        try:
            records = deps["store"].load(req.dataset_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="dataset not found")
        historical = HistoricalPriceSource(records)
        wholesale = FallbackWholesale(wholesale, historical)
        retail = FallbackRetail(retail, historical)
    return run_sourcing([i.model_dump() for i in req.items], req.location,
                        wholesale, retail, deps["llm"])
```

- [ ] **Step 8: Run the API tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_api.py -v`
Expected: all tests pass, including the 2 new ones.

- [ ] **Step 9: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass, 0 failures.

- [ ] **Step 10: Write the failing frontend test**

Add to `frontend/__tests__/sourcing.test.tsx`:
```tsx
it("passes datasetId through so sourcing can fall back to historical prices for unmatched items", async () => {
  const spy = vi.spyOn(api, "runSourcing").mockResolvedValue(DEMO_SOURCING);
  renderWithWizard(<SourcingPage />, { initial: { datasetId: "abc123", forecast: DEMO_FORECAST } });
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(spy.mock.calls[0][2]).toBe("abc123");
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `cd frontend && npm test -- sourcing.test.tsx`
Expected: FAIL — `runSourcing` currently takes only 2 arguments, so `spy.mock.calls[0][2]` is `undefined`, not `"abc123"`.

- [ ] **Step 12: Update `lib/api.ts`**

Change:
```ts
export function runSourcing(items: { item: string; qty: number }[], location: string): Promise<SourcingResponse> {
  return call("/sourcing", jsonInit({ items, location }), DEMO_SOURCING);
}
```
to:
```ts
export function runSourcing(
  items: { item: string; qty: number }[],
  location: string,
  datasetId?: string | null,
): Promise<SourcingResponse> {
  return call("/sourcing", jsonInit({ items, location, dataset_id: datasetId ?? undefined }), DEMO_SOURCING);
}
```

- [ ] **Step 13: Update `app/sourcing/page.tsx` to pass `datasetId` through**

Change:
```tsx
const { forecast, location, sourcing, hydrated, set } = useWizard();
```
to:
```tsx
const { forecast, location, sourcing, hydrated, set, datasetId } = useWizard();
```
And change:
```tsx
runSourcing(items, location)
```
to:
```tsx
runSourcing(items, location, datasetId)
```

- [ ] **Step 14: Run the frontend test to verify it passes**

Run: `cd frontend && npm test -- sourcing.test.tsx`
Expected: all tests in the file pass, including the new one.

- [ ] **Step 15: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: all tests pass, 0 failures.

- [ ] **Step 16: Live end-to-end confirmation with the user's real test CSV**

```bash
cd backend
uvicorn wastewise.api:app --host 127.0.0.1 --port 8099 &
sleep 3
curl -s -X POST http://127.0.0.1:8099/upload -F "file=@../datasets/wastewise_sales_test.csv"
```
Copy the returned `dataset_id`, then:
```bash
curl -s -X POST http://127.0.0.1:8099/sourcing -H "Content-Type: application/json" \
  -d '{"items":[{"item":"Mutton","qty":5}],"location":"40.7,-74.0","dataset_id":"<paste>"}'
```
Expected: `supplier: "Historical average"` with a non-zero `unit_price` (previously `"No price data"` / `$0.00`). Stop the server after.

- [ ] **Step 17: Commit**

```bash
git add backend/wastewise/adapters/price_historical.py backend/tests/test_price_historical.py \
        backend/wastewise/api.py backend/tests/test_api.py \
        frontend/lib/api.ts frontend/app/sourcing/page.tsx frontend/__tests__/sourcing.test.tsx
git commit -m "feat: fall back to historical price data for items no US API can price"
```

---

## Self-Review

- **Spec coverage:** Root cause A (dead LLM model, 100% fallback) → Task 1 ✔ (now dev-parity via Ollama+Mistral, matching the AMD box). Root cause B (USDA 401, silent) → Task 2 (loud diagnostic; the credential itself needs the user to rotate on USDA's site, which no amount of code can fix — Task 2 makes that failure impossible to miss again) ✔. Root cause C (naive Kroger match, dishonest notes, silent $0 lines) → Tasks 3 + 4 + 5 ✔. "Model looks broken on demo data" → Task 6 ✔. "Maximize AMD compute" → Task 5 (genuine per-item LLM selection reasoning, not a throwaway completion) + Task 7 (AMD path documented as the required primary, `LLM_REQUIRE_LIVE` gate wired for the real submission run) ✔. US-market-only sourcing limitation → Task 8 (historical-price fallback, no scraping, no new bespoke market API) ✔.
- **Explicit non-goals honored:** no GPU-trained forecaster rewrite, no bespoke non-US API integration, no live web scraping — all three called out in Global Constraints; Task 8 respects the scraping/bespoke-API exclusions by using only data already in the uploaded CSV.
- **Placeholders:** none — every step has runnable code, exact commands, and expected output.
- **Type/name consistency:** `SupplierPrice.description` (Task 3) is consumed by `price_kroger.py`'s `_parse_prices` (Task 4), `sourcing._choose_offer`'s candidate-listing string (Task 5), and `HistoricalPriceSource.get_retail_prices` (Task 8) — same attribute name throughout. `NO_BENCHMARK_NOTE`/`NO_MATCH_NOTE` are defined once in Task 3's version of `sourcing.py` and re-defined identically in Task 5's full-file replacement (Task 5 replaces the whole file, so it re-states them) — verified both tasks use the exact same string values so no test written against Task 3's constants breaks after Task 5 lands. `check_data_sources.check_sources(wholesale, retail) -> list[SourceStatus]` signature in Task 2 matches its own test's usage exactly. Task 8's `HistoricalPriceSource`/`FallbackWholesale`/`FallbackRetail` satisfy the existing `WholesaleSource`/`RetailSource` protocols from `adapters/base.py` structurally (Python protocols are duck-typed, no explicit inheritance needed) — verified their method signatures (`get_wholesale_price(item) -> float | None`, `get_retail_prices(item, location) -> list[SupplierPrice]`) match exactly. `runSourcing`'s new third parameter is appended (not inserted), so Task 8's frontend changes don't disturb the existing `spy.mock.calls[0][0]` assertion in the pre-existing sourcing test.
- **Ordering dependency:** Task 5 replaces the whole `sourcing.py` file body that Task 3 also modified — instructions in Task 5 Step 3 say "replace the full contents," which supersedes Task 3's version cleanly as long as Task 3 is done first (it is, per task order). Flagged explicitly in Task 5's context note. Task 8 depends on Task 3's `SupplierPrice.description` field and does not touch `sourcing.py` at all — it composes at the `api.py` layer only, so it has no ordering conflict with Task 5 and could in principle run before or after it (placed last here only because it was the most recently scoped).
