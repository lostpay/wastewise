# WasteWise Backend Deployment — Design

Date: 2026-07-08
Status: Approved (brainstorming) → ready for implementation plan
Related: `docs/specs/2026-07-07-wastewise-design.md`, `docs/plans/2026-07-07-wastewise-backend.md`,
frontend PR #2 (merged to `main` as `a62240d`), hosted frontend on Vercel.

## Goal

Make the already-built, already-hosted frontend run **real end-to-end** (real CSV upload →
real XGBoost forecast → real sourcing), and produce a credible **AMD compute** artifact for the
AMD Developer Hackathon (ACT II). Deadline: **2026-07-11 15:00 UTC**.

The backend code is complete and tested; this is a **deployment / ops** effort. No backend or
frontend source changes are required — everything here is configuration, hosting, and
documentation. If a trivial code touch turns out to help, it is called out explicitly; the default
is config-only.

## Key facts that shape the design

- **The backend boots with zero secrets.** Every setting in `backend/wastewise/config.py` has a
  default (`"changeme"`), so `uvicorn wastewise.api:app` starts with no `.env`.
- **The LLM is optional enrichment, not a dependency.** `agents/adjustment.py` and
  `agents/sourcing.py` both wrap the LLM call in `try/except` and fall back to deterministic
  output. Forecasts (XGBoost) and sourcing math work with no LLM at all.
- **`LLMClient` is OpenAI-compatible** (`agents/llm.py` uses the `openai` SDK with a configurable
  `base_url`). It can point at Fireworks, or at a local **vLLM** server, with no code change.
- **CORS is wide open** (`api.py`: `allow_origins=["*"]`), so any deployed frontend can call any
  deployed backend cross-origin.
- **Frontend `NEXT_PUBLIC_API_URL` is build-time.** Next.js bakes it into the client bundle, so
  changing which backend the site talks to means a Vercel redeploy. One deployment = one backend.
- **The AMD env is a JupyterLab session**, image **ROCm 7.2 + vLLM 0.16.0 + PyTorch 2.9**, with a
  Terminal and outbound internet. It has an **AMD GPU** (ROCm) and **vLLM preinstalled**. It is
  session-based and ephemeral — excellent as real AMD compute, poor as a 24/7 host.

## Architecture: two tracks, one backend

The same unchanged backend is deployed twice, each serving a distinct purpose.

### Track A — Render (the permanent public link) — RELIABILITY

Always-on FastAPI service on Render's free web tier. Vercel **production** points here.

- **Service:** Render Web Service, **root directory** `backend/`, Python runtime.
- **Build command:** `pip install -e .`
- **Start command:** `uvicorn wastewise.api:app --host 0.0.0.0 --port $PORT`
- **Environment variables (Render dashboard):**
  - `LLM_BASE_URL = https://api.fireworks.ai/inference/v1`
  - `LLM_MODEL = accounts/fireworks/models/llama-v3p1-8b-instruct`
  - `LLM_API_KEY = <user's Fireworks key>`
  - `USDA_API_KEY`, `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` — optional; adapters fall back
    gracefully if absent/invalid.
- **LLM on the permanent link:** Fireworks (hosted). The live site gets real LLM-generated reasons.
- **Accepted free-tier limits (documented, not fixed):**
  - Instance **sleeps after ~15 min idle**; first request after sleep cold-starts ~30–60s.
  - **Ephemeral filesystem** — uploaded datasets (SQLite at `db_path`) do not survive a
    restart/redeploy. Acceptable: a demo uploads a fresh CSV each run, then immediately forecasts.
  - These are noted in `frontend/README.md` / backend README so they never surprise a demoer.

### Track B — AMD box (the AMD story) — the vLLM-on-GPU compute

The same backend in the AMD Jupyter env, with the **LLM served on the AMD GPU by vLLM**, exposed
via a Cloudflare tunnel. Used for the demo video, `docs/AMD_USAGE.md` evidence, and optionally a
Vercel preview URL.

Steps (run in the AMD Jupyter Terminal):

1. **Probe** the env and confirm GPU + **VRAM**:
   `rocm-smi --showproductname --showmeminfo vram`; `torch.cuda.is_available()` /
   `get_device_name(0)` / `total_memory`; `import vllm`. (Full probe block in the plan.)
2. **Pick the model by VRAM:** ~≥16 GB → `meta-llama/Llama-3.1-8B-Instruct` (matches the Fireworks
   model family); if less → a smaller or quantized instruct model. Decision comes from the probe.
3. **Get the code + deps:** `git clone https://github.com/lostpay/wastewise.git`;
   `cd wastewise/backend`; `pip install -e .` (vLLM/torch already present in the image).
4. **Serve the LLM on the GPU:** `vllm serve <model> --port 8000` → OpenAI-compatible at
   `http://localhost:8000/v1`.
5. **Run the backend** on a separate port with the LLM pointed at local vLLM:
   `LLM_BASE_URL=http://localhost:8000/v1 LLM_MODEL=<model> LLM_API_KEY=dummy \`
   `uvicorn wastewise.api:app --host 0.0.0.0 --port 8080`.
6. **Tunnel it public:** download `cloudflared`, then
   `./cloudflared tunnel --url http://localhost:8080` → public HTTPS URL.

Two long-running processes (vLLM, uvicorn) + the tunnel; keep the session alive during use.

## Frontend wiring (Vercel)

- **Production:** `NEXT_PUBLIC_API_URL = <Render URL>`; redeploy once. Permanent real end-to-end.
- **Optional preview (AMD-backed):** a branch/preview deployment with
  `NEXT_PUBLIC_API_URL = <cloudflared URL>` gives a second, AMD-served URL for the live/recorded
  demo without touching production. Refresh when the quick-tunnel URL rotates.

## `docs/AMD_USAGE.md` (the artifact that earns the credit)

Concrete evidence, not a claim:
- The `vllm serve` launch command and the model served.
- `rocm-smi` output identifying the AMD GPU, plus GPU utilization during a request.
- A short **benchmark**: latency / tokens-per-sec for the forecast-reason and sourcing-note
  generation on the AMD GPU.
- 1–2 screenshots (JupyterLab terminal + `rocm-smi`).
- One paragraph mapping the app's LLM calls (`adjustment.py`, `sourcing.py`) to the AMD GPU path.

## Verification

- **Render:** `curl <render>/health` → `{"status":"ok"}`; then drive the **live Vercel production
  site** end-to-end with the prepared CSV (`scripts/prepare_dataset.py` output) — upload → forecast
  → sourcing → order — and confirm numbers are real (not the demo fixtures).
- **AMD:** same end-to-end against the tunnel URL (via the preview deploy or a local frontend),
  and confirm LLM reasons originate from vLLM with GPU activity visible in `rocm-smi`.

## Sequencing (deadline-aware)

1. **Track A first (~half day):** deploy Render, set Vercel prod `NEXT_PUBLIC_API_URL`, verify.
   Yields an immediate permanent real demo at lowest risk.
2. **Track B (~half day):** probe → vLLM serve → backend → tunnel → write `AMD_USAGE.md`.
3. **Demo video (separate later session):** recorded against the AMD preview URL.

Track A is independent of Track B, so a permanent working demo exists even if the AMD env is
uncooperative near the deadline.

## Risks & mitigations

- **AMD Jupyter session resets** (loses installed state + running processes) → script the setup so
  it re-runs fast; do Track B close to when the video is recorded.
- **Cloudflare quick-tunnel URL rotates on restart** → only wire it to a Vercel *preview*, refresh
  as needed; never make production depend on it.
- **Render cold start** after idle sleep → hit the URL once to warm it before demoing.
- **Model too large for VRAM** on the AMD GPU → fall back to a smaller/quantized instruct model
  (decided from the probe before committing).
- **Fireworks key rate limits / cost** on the permanent link → LLM is optional; the backend
  degrades to deterministic reasons rather than failing.

## Out of scope

- Slide deck and demo-video production (separate later session).
- Replacing frontend demo fixtures with captured real responses (optional, not required — the live
  site now calls the real backend directly).
- A stable named Cloudflare tunnel / custom domain (only needed if a permanent AMD-backed URL is
  wanted; not required for the demo).
- Any AMD GPU acceleration of XGBoost itself (the AMD compute story is the vLLM-served LLM).
