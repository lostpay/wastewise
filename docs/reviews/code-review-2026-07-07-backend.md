# WasteWise Backend — Code Review (2026-07-07)

Reviewer lens: security → performance → correctness → maintainability. This
review was run over the completed backend branch (Plan 1, Tasks 0–16) *after*
the SDD per-task reviews and the whole-branch review + fix wave, as a fresh
security/robustness pass on the untrusted HTTP boundary.

**Status:** Findings #1–#3 fixed in this pass (commit adds 5 regression tests,
suite 34 → 39 passing). Remaining items are documented, conscious MVP
trade-offs.

---

## Strengths

- **No SQL injection.** `storage.py:20,26` use parameterized queries (`?`
  placeholders) throughout; the `CREATE TABLE` is a static string.
- **No hardcoded secrets.** Credentials come from the environment via
  `get_settings()` (`api.py`), `.env` is git-ignored, and defaults are obvious
  placeholders (`"changeme"`), never real keys.
- **Degrade-don't-crash design.** Adapters return neutral/empty values on
  upstream failure (`weather_noaa.py:27`, `price_kroger.py:30`) and both LLM
  steps have non-LLM fallbacks (`adjustment.py`, `sourcing.py:12`).

---

## Fixed in this pass

### 1. Kroger OAuth token re-fetched per item — HTTP N+1 (High, performance)
`adapters/price_kroger.py`

`get_retail_prices` fetched a fresh client-credentials token on every call, and
`source_order` calls it once **per line item**. A 10-item order meant 10 OAuth
token round-trips on top of 10 product calls and 10 LLM calls — serial, and
directly against the <30s/request budget.

**Fix:** the token is now cached on the adapter instance with its `expires_in`
(refreshed 60s early); a multi-item request re-authenticates at most once.
Regression test: `test_token_is_reused_across_items` asserts the token route is
hit exactly once across two distinct items.

### 2. Malformed CSV returned 500 instead of 400 (Medium, correctness)
`ingest.py`, `api.py` (`/upload`)

`/upload` only caught `ValueError`. A *ragged* CSV row left `quantity=None`, so
`float(None)` raised **`TypeError`** and escaped as a 500. A non-UTF-8 upload
raised `UnicodeDecodeError` at `.decode("utf-8")` before parsing, also a 500.

**Fix:** `parse_sales_csv` now wraps per-row coercion and re-raises
`TypeError`/`ValueError` as a `ValueError` naming the offending row number; the
`/upload` decode is wrapped to return a 400 on non-UTF-8 input. Regression
tests: `test_parse_ragged_row_raises_valueerror`,
`test_parse_bad_quantity_raises_valueerror`, `test_upload_rejects_non_utf8`.

### 3. Unvalidated `location` interpolated into an outbound URL (Medium, security)
`api.py` request models, `adapters/weather_noaa.py:21`

`ForecastRequest.location` / `SourcingRequest.location` were free strings
interpolated raw into `https://api.weather.gov/points/{location}`. The host is
pinned (not full SSRF, and `FileCache` SHA-hashes keys so there's no disk path
traversal), but a value like `40.7,-74.0/../gridpoints/...` could walk to other
weather.gov paths.

**Fix:** both request models now share `_LocatedRequest`, which validates
`location` against a `lat,lon` regex — bad input is rejected at the 422
boundary. Regression test: `test_forecast_rejects_malformed_location`.

---

## Documented — left as-is (conscious MVP trade-offs)

### 4. CORS fully open (Medium, security)
`api.py`: `allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]`.
Acceptable for a hackathon demo (no auth, no credentialed endpoints,
`allow_credentials` defaults False). **Before any real deployment**, pin
`allow_origins` to the deployed frontend origin.

### 5. Prompt-injection surface (Low)
`sourcing.py:9-11` / `adjustment.py`: a crafted `item` name flows into the LLM
prompt and the resulting `note` is echoed in the response. It **cannot** affect
the deterministic supplier/price selection, so worst case is a junk note string.
Low impact; noted for awareness.

### 6. Precipitation semantics (Low, correctness)
`weather_noaa.py:38,41`: NOAA's `probabilityOfPrecipitation.value` is a percent
(0–100) but is divided by 10 and stored as `precipitation_mm`. Not a crash; the
field is a proxy, not real mm. The plan already flags the NOAA parse for live
verification — worth a code comment when that verification happens.

### 7. Silent $0 line (Low, correctness)
`sourcing.py:33`: an item with neither a retail offer nor a wholesale benchmark
becomes `supplier="Market", unit_price=0.0` — a zero-priced line with no signal.
Consider a `note` flagging "no price data" if this case can occur with real
adapters.

### 8. Duck-typed agent params (Low, maintainability)
`sourcing.py:19` and the pipeline pass `wholesale`/`retail`/`llm` untyped though
the `WholesaleSource`/`RetailSource` Protocols exist in `adapters/base.py`.
Annotating would restore type-checker/IDE support. Cosmetic.

---

## Verification

`cd backend && .venv/Scripts/python.exe -m pytest -q` → **39 passed** (34 prior +
5 new regression tests for findings #1–#3).
