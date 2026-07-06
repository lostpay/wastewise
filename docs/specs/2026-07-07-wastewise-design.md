# WasteWise — Design Spec

**Date:** 2026-07-07
**Status:** Approved (brainstorming complete) — ready for implementation planning
**Context:** AMD Developer Hackathon: ACT II submission (Unicorn track), deadline **July 11, 2026**. Also intended as a growable portfolio project.

---

## 1. Summary

WasteWise is an **autonomous purchasing assistant for restaurants**. A restaurant uploads its historical sales; WasteWise forecasts how much of each item it will need, an LLM agent adjusts those numbers for weather and holidays (with plain-language reasons), a second agent sources ingredient prices and drafts an approve-able purchase order.

**Core loop:** `sales history → forecast → agent adjusts & explains → agent sources & prices → drafted purchase order`.

**One-line pitch:** Predicts ingredient demand, benchmarks supplier costs against live market data, and drafts the purchase order — cutting over-ordering and food waste.

---

## 2. Goals & non-goals

### Goals (MVP, by July 11)
- Upload sales data (public dataset for demo; CSV upload for real use) and forecast per-item demand.
- LLM agent adjusts the forecast for **weather + holidays** and explains each change.
- LLM agent **sources supplier prices** (wholesale benchmark + retail) and recommends where to buy.
- Produce a **drafted purchase order** the user can approve/export (human-in-the-loop).
- Run the LLM agents on **vLLM / AMD MI300X** (the hackathon's GPU requirement); dev against Fireworks with a one-line swap.
- A usable **Next.js** web UI (4 stepwise screens) — feels like a real product.

### Non-goals (explicitly deferred to v2)
- **Recipe / bill-of-materials mapping** (dish → ingredients). MVP forecasts and buys at the *item* level.
- **Waste-photo feedback loop** (vision model estimating bin waste to self-correct). Flagged as the flagship v2 feature.
- **Deep-learning forecaster** (PyTorch time-series trained on the GPU). v2 upgrade.
- Accounts, auth, multi-tenant persistence. MVP is single-session.
- Live ordering / payment. MVP drafts; a human approves and acts.

---

## 3. Market & data decision

Market-agnostic engine, **demoed with US free APIs** (chosen for reliability and zero cost, not because US is the only target). Data sources sit behind a swappable adapter interface so other markets (e.g. Taiwan's 農業部 API) plug in later.

- **Wholesale benchmark:** USDA Market News / MyMarketNews (MARS API).
- **Retail supplier prices:** Kroger Products API (free public tier, ~10k calls/day).
- **Weather:** NOAA / National Weather Service API (`api.weather.gov`, free, no key).
- **Holidays/events:** a holiday calendar source.
- **Sales data:** a public Kaggle restaurant/café sales dataset for the demo.

---

## 4. Architecture

```
Next.js frontend (Vercel)
  Screens: Setup → Forecast+Adjustments → Sourcing → Purchase Order
        │  REST (JSON)
        ▼
FastAPI backend  (on AMD Developer Cloud, next to vLLM)
  1. Forecast engine    → XGBoost + statistical baseline (per item)
  2. Agent orchestrator → LLM (on vLLM) for:
       • weather/holiday adjustment + explanation
       • supplier sourcing (compare prices, choose, draft PO)
  3. Data adapters (swappable behind a common interface):
       • USDA Market News   (wholesale benchmark)
       • Kroger Products API (retail prices)
       • NOAA weather        (demand signal)
       • Holiday calendar
  4. Storage: SQLite (sales, forecasts, orders)
        │  OpenAI-compatible API
        ▼
vLLM serving an open LLM on AMD MI300X (ROCm)
  dev fallback: Fireworks API — same client, swap base_url
```

### Two cross-cutting design choices
1. **LLM behind one interface.** An OpenAI-compatible client; `LLM_BASE_URL` points to **Fireworks** in dev and **vLLM/MI300X** for submission. No code change to switch. De-risks day-1 GPU access.
2. **Swappable data adapters.** Each price/weather source implements a common interface (e.g. `PriceSource`), so markets are pluggable — this is the "market-agnostic" property with no extra work.

### Solo-friendliness
Backend splits into four independent, testable units (forecaster, agents, adapters, storage). Frontend is ~4 screens. Each stage is its own endpoint.

---

## 5. Components

### 5.1 Forecast engine
- **Input:** CSV `date, item, quantity` (price optional). Demo loads a bundled public dataset; upload path accepts a restaurant's own export.
- **Model (Approach B):** XGBoost predicting next-period demand **per item**. Features: day-of-week, week-of-year, lag features (e.g. same day last week), rolling averages, holiday flag, weather signal.
- **Baseline:** a simple seasonal method (previous-week value / Holt-Winters), always computed. Used as (a) a comparison stat ("XGBoost beats baseline by X%") and (b) a fallback if the model errors.
- **Horizon:** next-day and next-week.
- **Purchase mechanic (MVP, item-level):** `recommended_purchase_qty = forecast + safety_buffer − current_stock(optional)`.
- **Output:** per item → `{ forecast, safety_buffer, recommended_purchase_qty }`.

### 5.2 Agent orchestrator
**Design: structured pipeline, not free-roaming autonomy.** The orchestrator calls data tools deterministically and uses the LLM only for the two judgment steps. Genuinely agentic (reasoning + tool-grounded actions), but demo-stable. All LLM output is **schema-validated JSON** (e.g. Pydantic); malformed output triggers a retry then a safe fallback.

**Tools (deterministic fetchers):**
- `get_weather(date, location)` → NOAA
- `get_holidays(date_range)` → holiday calendar
- `get_wholesale_price(item)` → USDA Market News
- `get_retail_prices(item)` → Kroger Products API

**Step 1 — Adjustment agent.** Input: raw per-item forecast + weather + holidays. Output JSON: `{ item, adjusted_qty, reason }` (e.g. "rain Thu + non-holiday → −15% fried items").

**Step 2 — Sourcing agent.** Input: adjusted purchase list + tool prices. Compares retail vs USDA benchmark, chooses supplier, drafts PO lines. Output JSON: `{ item, qty, supplier, unit_price, line_total, note }` + justification.

**GPU usage:** both LLM steps call the vLLM endpoint on the MI300X — the concrete "runs on AMD" story.

**Optional showpiece (fenced stretch):** LLM-extraction scrape of one *public* supplier page (messy HTML → structured prices via the MI300X LLM). APIs are the reliable MVP path; the scrape only ships if time allows and is **cached** so it can't break live.

### 5.3 Data adapters
Each source is a thin adapter implementing a common interface, with a local **cache** layer. Adapters return normalized records so the agents are source-agnostic.

### 5.4 Storage
SQLite for MVP: sales datasets, computed forecasts, drafted orders. No accounts.

---

## 6. Frontend (Next.js) — 4 stepwise screens

Each screen maps to one backend call; stepwise (not a single dashboard) so each is a demo beat and independently testable.

1. **Setup** — upload sales CSV or pick the bundled demo dataset; set location (drives weather + regional prices) and horizon. → `POST /upload`
2. **Forecast & Adjustments** — per-item forecast charts; baseline-vs-XGBoost stat; adjustment agent changes shown as raw → adjusted with a **reason badge**. → `POST /forecast`
3. **Sourcing** — per-item price table (USDA benchmark vs Kroger retail); best supplier highlighted; savings called out. → `POST /sourcing`
4. **Purchase Order** — drafted PO (item, qty, supplier, unit price, line total, grand total) + justification; **Approve / Export** (download CSV). The "real product" payoff.

**State:** a `dataset_id` threads through the calls. No auth for MVP.

---

## 7. API endpoints

```
POST /upload    → { dataset_id, summary }
POST /forecast  → { items: [{item, forecast, adjusted_qty, reason}], baseline_delta }
POST /sourcing  → { lines: [{item, qty, supplier, unit_price, line_total, note}], total, savings }
GET  /health
```

---

## 8. Error handling — "the demo must not break"

- **External API down / rate-limited:** serve from local cache; if empty, seeded fallback values. Pipeline never hard-fails on a network hiccup.
- **LLM malformed JSON:** schema-validate → retry once → fall back to the *unadjusted* forecast (still valid).
- **Forecaster error:** fall back to the baseline. There is always a number on screen.
- **Golden rule:** for the live demo, **pre-cache every external response** for the demo dataset + location, so the walkthrough runs even with no network.

---

## 9. Testing (time-boxed)

- **Unit:** forecaster (asserts it matches/beats baseline on sample data); each data adapter (against mocked API responses); agent output schema validation.
- **Integration:** one test running the full pipeline on the demo dataset → a valid purchase order.

---

## 10. Configuration & secrets

`.env`:
- `USDA_API_KEY`
- `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` (OAuth)
- `LLM_BASE_URL` (Fireworks in dev → vLLM/MI300X for submission), `LLM_API_KEY`, `LLM_MODEL`

Same OpenAI-compatible client regardless of `LLM_BASE_URL`.

---

## 11. Deployment

- **Backend + vLLM:** on the AMD Developer Cloud instance (`uvicorn` + `vllm serve <model>`), CORS open to the frontend.
- **Frontend:** Vercel (or run locally pointed at the backend for the demo).

---

## 12. Hackathon fit

- **Track:** Unicorn (product potential + originality).
- **GPU story:** both agent steps run on vLLM / AMD MI300X (ROCm).
- **Submission:** repo + ~90-second demo video + writeup, before **July 11, 2026**.
- **Demo beats:** upload → forecast (beats baseline) → "typhoon/holiday" adjusts the order with a reason → sourcing shows savings vs market → approve & export the PO.

---

## 13. Tech stack

- **Backend:** Python, FastAPI, XGBoost, pandas, Pydantic, SQLite, `openai` client (for vLLM/Fireworks).
- **Frontend:** Next.js / React (charts for forecasts).
- **Infra:** AMD Developer Cloud (MI300X, ROCm, vLLM); Vercel for the frontend.
- **External APIs:** USDA Market News, Kroger Products, NOAA weather, holiday calendar.

---

## 14. Rough solo sequence (adjust freely)

- **Day 1:** repo scaffold; load Kaggle data; forecaster (baseline + XGBoost); `/upload` + `/forecast`.
- **Day 2:** data adapters (USDA / Kroger / NOAA) + both agent steps against Fireworks; `/sourcing`.
- **Day 3:** Next.js 4 screens wired to the API; stand up AMD Cloud + vLLM; flip `LLM_BASE_URL`.
- **Day 4:** pre-cache demo data; polish; record video; write submission.

---

## 15. Roadmap (post-hackathon / portfolio v2)

1. **Waste-photo feedback loop** — vision model (on MI300X) estimates end-of-day waste to self-correct the forecast. The flagship differentiator.
2. **Recipe / BOM layer** — forecast dishes, roll up to ingredient purchases (full-service restaurants).
3. **Deep-learning forecaster** — PyTorch time-series (LSTM/TFT) trained on the MI300X.
4. **Accounts + persistence** — multi-restaurant history and tracking.
5. **Live-scraping sourcing** — LLM-extraction across more supplier sites, cached.
