# WasteWise

**Predicts ingredient demand, benchmarks supplier costs against live market data, and drafts the purchase order — cutting over-ordering and food waste.**

A restaurant uploads its sales history. WasteWise forecasts how much of each item it will need, an LLM agent adjusts those numbers for weather and holidays (with a plain-language reason per item), a second agent benchmarks supplier prices and picks the best listing, and the result is a drafted purchase order a human approves and exports.

```
sales history → forecast → agent adjusts & explains → agent sources & prices → drafted PO
```

Built solo for the [AMD Developer Hackathon: ACT II](https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-ii) (Unicorn track).

## Live demo

- **App:** https://wastewise-theta.vercel.app
- **API:** https://wastewise-backend.onrender.com ([health](https://wastewise-backend.onrender.com/health)) — free tier, first request may cold-start ~30–60 s
- **Demo video (~90 s):** <!-- TODO: add video link -->
- **Slide deck (PDF):** <!-- TODO: add deck link/path -->

## AMD compute usage

Both LLM judgment steps — demand adjustment and supplier selection — run inference on an open model served by **vLLM on an AMD Radeon PRO W7900 (48 GB VRAM, RDNA3/gfx1100, ROCm)** on the AMD Developer Cloud, exposed through an OpenAI-compatible endpoint:

```
vllm serve mistralai/Mistral-7B-Instruct-v0.3 --port 8000
```

The backend points at it with a single env var (`LLM_BASE_URL`) — no code change between dev and the AMD GPU path.

![rocm-smi with the model resident on the W7900](docs/images/rocm-smi.png)

Full evidence (rocm-smi output, vLLM server logs, latency benchmark) and reproduction steps: [docs/AMD_USAGE.md](docs/AMD_USAGE.md).

## How it works

1. **Setup** — upload a sales CSV (`date, item, quantity, price?`) or use the bundled demo dataset; pick a location on the map (drives weather and regional prices) and a horizon (day/week).
2. **Forecast** — an XGBoost model forecasts per-item demand, backtested against a seasonal baseline on a 7-day holdout (the improvement is shown on screen, measured, not asserted). The adjustment agent then revises each item for the forecast weather and upcoming holidays, with a one-sentence reason per item.
3. **Sourcing** — each item is priced against live retail listings (Kroger API) and a US retail average benchmark (BLS via FRED). The sourcing agent picks the best plain-commodity listing among the candidates and explains the choice.
4. **Order** — a drafted purchase order with line totals, total, savings vs. benchmark, and an agent-written purchasing rationale. Approve and export to CSV.

Every AI-generated figure carries a `live` flag: when the model is unreachable, the UI says so instead of faking a reason.

## Architecture

```
Next.js frontend (Vercel)
  Setup → Forecast → Sourcing → Order
        │ REST (JSON)
        ▼
FastAPI backend
  forecast engine   XGBoost + seasonal baseline, per item
  agent steps       adjustment · sourcing selection · PO rationale
  data adapters     NOAA weather · US holidays · FRED/BLS prices · Kroger retail
  storage           SQLite
        │ OpenAI-compatible API
        ▼
vLLM on AMD Radeon PRO W7900 (ROCm)
```

Design choices that matter:

- **Structured pipeline, not free-roaming autonomy.** Data tools are called deterministically; the LLM makes the judgment calls (adjust, select, justify) with schema-validated JSON output. A purchasing agent that hallucinates a tool call drafts a wrong order.
- **Swappable adapters.** Every data source implements a common interface with a file cache and graceful fallback — other markets plug in without touching the agents.
- **The demo must not break.** External API failure → cache → seeded fallback; LLM failure → unadjusted forecast, honestly labeled. There is always a number on screen.

## Run locally

Backend:

```bash
cd backend
pip install -e ".[dev]"
cp .env.example .env   # point LLM_BASE_URL at vLLM (or any OpenAI-compatible endpoint)
uvicorn wastewise.api:app --reload
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env.local   # set NEXT_PUBLIC_API_URL
npm run dev
```

Tests: `pytest -q` in `backend/` (78 tests), `npm test` in `frontend/` (43 tests).

Deployment runbook (Render + Vercel + the AMD box): [docs/DEPLOY.md](docs/DEPLOY.md).

## Roadmap

- **Waste-photo feedback loop** — vision model estimates end-of-day bin waste to self-correct the forecast.
- **Recipe/BOM layer** — forecast dishes, roll up to ingredient purchase orders for full-service restaurants.
- **Deep-learning forecaster** — PyTorch time-series (LSTM/TFT) trained on AMD GPUs.
- **Accounts & persistence** — multi-restaurant history and order tracking.

## License

[MIT](LICENSE)
