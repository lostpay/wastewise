# WasteWise — Implementation Status

Snapshot of what's built vs. what's missing, measured against the design spec at [docs/specs/2026-07-07-wastewise-design.md](specs/2026-07-07-wastewise-design.md).

Submission deadline: **2026-07-11, 15:00 UTC** (~24 hours from now).

---

## ✅ Implemented

### Backend — full MVP pipeline

- **CSV ingestion** ([ingest.py](../backend/wastewise/ingest.py)) — parses `date, item, quantity, price?`, UTF-8 validation, row-level error reporting, SQLite persistence via [`DatasetStore`](../backend/wastewise/storage.py).
- **Forecast engine**
  - XGBoost regressor with `dow, weekofyear, month, lag7, roll7` features ([forecaster.py](../backend/wastewise/forecasting/forecaster.py))
  - Naive-baseline seasonal comparison ([baseline.py](../backend/wastewise/forecasting/baseline.py))
  - `baseline_delta` — measured MAE improvement over baseline, from a 7-day holdout backtest
  - 15% safety buffer on recommended purchase quantity
- **Data adapters** (all with FileCache + graceful fallback)
  - NOAA weather via weather.gov ([weather_noaa.py](../backend/wastewise/adapters/weather_noaa.py))
  - US federal holidays ([holidays.py](../backend/wastewise/adapters/holidays.py))
  - US retail average prices via FRED/BLS series ([price_fred.py](../backend/wastewise/adapters/price_fred.py))
  - Kroger retail prices with OAuth + lat,lon→locationId resolution ([price_kroger.py](../backend/wastewise/adapters/price_kroger.py))
- **LLM agents**
  - Adjustment agent — sends recommendations + weather + holidays, expects per-item JSON ([adjustment.py](../backend/wastewise/agents/adjustment.py))
  - Sourcing agent — writes one-liner comparing chosen price to the FRED/BLS benchmark ([sourcing.py](../backend/wastewise/agents/sourcing.py))
  - OpenAI-compatible client wrapper ([llm.py](../backend/wastewise/agents/llm.py)) — works against vLLM or Fireworks
  - Loud startup check — logs live vs. fallback mode at boot
- **Pipeline orchestrator** ([pipeline.py](../backend/wastewise/pipeline.py))
- **FastAPI endpoints** ([api.py](../backend/wastewise/api.py))
  - `/health`, `/upload`, `/forecast`, `/sourcing`
  - Pydantic validation, lat,lon regex hardening (SSRF protection on weather.gov URL), CORS
- **Backend test suite** — 15 test files, `pytest -q` green

### Frontend — 4-screen wizard

- **Setup** ([setup/page.tsx](../frontend/app/setup/page.tsx))
  - Drag-and-drop CSV zone with header/size validation + sample download ([csv-dropzone.tsx](../frontend/components/ui/csv-dropzone.tsx))
  - Google Maps location picker — Places autocomplete + click-to-pick + reverse geocode + classic-marker fallback when no Map ID ([location-picker.tsx](../frontend/components/ui/location-picker.tsx))
  - Horizon dropdown (day / week)
  - Mount-time state reset — clears prior `datasetId`/`forecast`/`sourcing` so navigating back to Setup restarts cleanly
- **Forecast** ([forecast/page.tsx](../frontend/app/forecast/page.tsx))
  - StatTile showing `baseline_delta`
  - Bar chart: raw forecast vs. LLM-adjusted quantity per item
  - Per-item rows with reason badges
- **Sourcing** ([sourcing/page.tsx](../frontend/app/sourcing/page.tsx))
  - StatTile for total savings vs. benchmark
  - Price table with supplier, unit price, line total
- **Order** ([order/page.tsx](../frontend/app/order/page.tsx))
  - PO table, Approve button, Download CSV export
- **Cross-cutting**
  - Wizard state persisted to sessionStorage with corrupt-state recovery ([store.tsx](../frontend/lib/store.tsx))
  - Stepper sidebar with jump-back logic gated on prior-step state ([stepper.tsx](../frontend/components/stepper.tsx))
  - Redirect-notice card on out-of-order navigation ([redirect-notice.tsx](../frontend/components/redirect-notice.tsx))
  - Demo-mode fallback — canned responses whenever backend is unreachable or key is unset ([demo.ts](../frontend/lib/demo.ts), [api.ts](../frontend/lib/api.ts))
- **Frontend test suite** — 37 tests, `npm test` green

### Infrastructure & deployment

- **Render blueprint** for backend deploy ([render.yaml](../render.yaml))
- **AMD notebook boot script** for vLLM ([scripts/amd_setup.sh](../scripts/amd_setup.sh))
- **Deploy runbook** ([DEPLOY.md](DEPLOY.md)) — linked from both READMEs
- **AMD usage doc** ([AMD_USAGE.md](AMD_USAGE.md)) — repro commands + benchmark template
- **MIT LICENSE** at repo root ✅ (submission-mandatory)
- **Public GitHub repo** at https://github.com/lostpay/wastewise ✅ (submission-mandatory)

### Design & planning artifacts

- Design specs — backend, frontend, deploy under [docs/specs/](specs/)
- Implementation plans under [docs/plans/](plans/)
- Code review documents under [docs/reviews/](reviews/)

---

## ❌ Missing / At risk

### Submission-mandatory deliverables (per spec §12)

| Item | Status | Notes |
|---|---|---|
| Public GitHub repository | ✅ Done | https://github.com/lostpay/wastewise |
| MIT LICENSE | ✅ Done | Committed at repo root |
| **Demo video (~90s)** | ❌ **Not created** | No `.mp4`/`.mov`/`.gif` under repo (excluding `.venv` deps). Must record and publish. |
| **Slide deck (PDF)** | ❌ **Not created** | No `.pdf` under repo. Automated pre-screening reads the deck for AMD usage claim — this is a hard gate. |
| **Hosted live URL** | ⚠️ **Unverified** | Deploy blueprint + runbook exist; can't confirm from repo alone whether Vercel + Render are live right now. |
| **`rocm-smi` / vLLM endpoint screenshots** | ⚠️ **Referenced, not committed** | [AMD_USAGE.md](AMD_USAGE.md) references screenshots but no `.png`/`.jpg` under [docs/](.). Must commit actual image files. |

### Working with caveats

- **LLM agent produces real reasons** — code path is complete, but in practice items often display *"No adjustment applied"* (the hardcoded fallback string at [adjustment.py:15](../backend/wastewise/agents/adjustment.py#L15)). Means the LLM call is failing silently.
  - Root cause candidates: unset `LLM_API_KEY`, wrong `LLM_BASE_URL`, model ID mismatch, malformed JSON from the LLM, >30s timeout.
  - The `c78e984` loud-startup-check commit was added specifically to make this visible on boot.
  - **This is the AMD compute gate — if the LLM call falls back during demo, AMD usage is not demonstrated.** Critical to verify before recording.

### Spec goals deferred / partial

- **Stretch: LLM-extraction supplier scrape** (spec §5.2) — explicitly optional. Zero commits reference it. Ship without.

### Frontend polish gaps (cosmetic only)

- **Map ID for AdvancedMarker** — `NEXT_PUBLIC_GOOGLE_MAP_ID` env slot exists; unset means the picker uses classic marker and Google logs a yellow console warning. Zero functional impact.
- **"Use my current location" button** — never built. Convenience feature; would let judges test with real weather at their location in one click.

### Spec-declared non-goals (deliberate exclusions)

Per spec §2 — do **not** attempt before submission:
- Recipe / bill-of-materials mapping (dish → ingredients)
- Waste-photo feedback loop (flagship v2 differentiator)
- Deep-learning forecaster (PyTorch LSTM/TFT on MI300X)
- Accounts / auth / multi-tenant persistence
- Live ordering / payment
- Multi-market adapters beyond FRED/Kroger/NOAA/US holidays

---

## Priority-ordered TODO before submission

**Must ship** (fail pre-screening / disqualification risk if missing):

1. **Verify LLM adjustment produces real reasons end-to-end.** Boot backend against the vLLM endpoint, hit `/forecast`, confirm the JSON response has weather- or holiday-referencing `reason` fields — not *"No adjustment applied."* If it falls back, fix env before anything else.
2. **Slide deck (PDF).** Include a slide explicitly stating *"agent inference runs on vLLM on AMD MI300X"* with a `rocm-smi` screenshot embedded. Commit the PDF and link it from the README.
3. **Commit `rocm-smi` + vLLM endpoint screenshots** to [docs/](.). Reference them from both [AMD_USAGE.md](AMD_USAGE.md) and the slide deck.
4. **Deploy the hosted URL.** Frontend on Vercel, backend on Render using [render.yaml](../render.yaml). Verify demo-mode fallback keeps the frontend usable even if the backend hiccups mid-judging.
5. **Record demo video (~90s).** Beat sheet per spec §12: upload → forecast (beats baseline) → weather/holiday adjustment with a reason → sourcing shows savings → approve & export PO.

**Nice-to-have only if #1–#5 are done:**

6. Create Google Maps Map ID, set `NEXT_PUBLIC_GOOGLE_MAP_ID` — clears the console warning judges might see.
7. Add "Use my current location" button to the picker (~15 lines).

**Do not touch:**

- Anything in spec §15 (waste-photo loop, PyTorch forecaster, accounts, etc.)
- LLM supplier scrape stretch

---

## Test & type check status

| Command | Result | Coverage |
|---|---|---|
| Backend `pytest -q` | ✅ Green | 15 test files across adapters, pipeline, ingest, forecaster, LLM, holidays, storage |
| Frontend `npm test` | ✅ Green | 37 tests |
| Frontend `npx tsc --noEmit` | ✅ Green | Full type check clean |

---

## Environment configuration

Backend ([backend/.env](../backend/.env)) — real values required:

| Key | Required for | Impact if unset |
|---|---|---|
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | The AMD compute gate | Agent falls back to canned strings; AMD usage not demonstrated |
| `FRED_API_KEY` | Sourcing savings figure | Savings always $0.00 |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | Real retail supplier prices | "Market" fallback with FRED-benchmark pricing |

Frontend ([frontend/.env.local](../frontend/.env.local)):

| Key | Required for | Impact if unset |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Live backend calls | Falls back to demo-mode canned responses |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map picker on Setup | Falls back to plain lat,lon text input |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | AdvancedMarker on the map | Falls back to classic marker + yellow console warning |

---

## TL;DR

- **Code is done.** All four screens work, all backend endpoints work, all adapters + tests are in.
- **Submission package is what's missing:** slide deck, demo video, hosted URL, committed AMD screenshots.
- **One technical risk** to verify before recording: the LLM adjustment step must actually produce weather/holiday reasoning, not fall back to *"No adjustment applied."* This is the AMD compute gate the whole hackathon submission hinges on.
