# WasteWise Backend Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the WasteWise backend as a permanent always-on public API (Render) that the hosted Vercel frontend calls for real, plus a scripted AMD-GPU (vLLM) path that earns the AMD-compute credit — all via config, scripts, and docs, with no source-code changes.

**Architecture:** The same, unchanged backend is deployed twice. **Track A (Render):** a free web service, Fireworks-hosted LLM, wired to Vercel production — the reliable permanent link. **Track B (AMD box):** the identical backend in the AMD Developer Cloud notebook with the LLM served on a Radeon PRO W7900 by vLLM and exposed via a Cloudflare tunnel — the AMD story (demo video + `docs/AMD_USAGE.md` evidence + optional Vercel preview). This plan produces the turnkey artifacts and a local proof that the exact deploy commands work; the interactive dashboard/notebook steps are captured as a user runbook.

**Tech Stack:** FastAPI + uvicorn, Render Blueprint (`render.yaml`), Vercel (Next.js build-time env), vLLM 0.16 on ROCm 7.2, cloudflared, Fireworks (OpenAI-compatible LLM).

## Global Constraints

- Work ONLY in `C:\Users\PF3AD\Downloads\projects\supply and demand` (its own git repo — GitHub `github.com/lostpay/wastewise`). Never touch the parent `projects` repo.
- Commits: plain Conventional Commits, **NO AI-attribution trailer**. Subagents commit but **never push**; pushing is the user's call.
- **No backend or frontend source-code changes.** This effort is config + scripts + docs only.
- Backend requires Python **>= 3.11** (`backend/pyproject.toml`).
- Frontend `NEXT_PUBLIC_API_URL` is **build-time** — one Vercel deployment points at exactly one backend; changing it needs a redeploy.
- **Secrets never enter git.** Render secrets use `sync: false` (entered in the dashboard); the Fireworks key is never committed.
- The LLM is **optional** — the backend must boot and serve with no LLM keys (deterministic fallbacks in `agents/adjustment.py` and `agents/sourcing.py`).
- Known AMD hardware: **Radeon PRO W7900, 48 GB VRAM, RDNA3/gfx1100, ROCm** (per `backend/README.md`). Default served model: `meta-llama/Llama-3.1-8B-Instruct` (fits 48 GB with room to spare).

## Branch & working-tree notes (read before Task 1)

- Base this work on `main` (frontend PR #2 is already merged). Do it on a branch `chore/deploy`.
- The deployment design spec `docs/specs/2026-07-08-wastewise-deploy-design.md` currently sits on local branch `frontend` (commit `34730e2`). Ensure it is present on `chore/deploy` (cherry-pick `34730e2`, or re-create it) so the deploy work is self-contained.
- Pre-existing unrelated working-tree edits (`docs/plans/2026-07-07-wastewise-backend.md`, `docs/specs/2026-07-07-wastewise-design.md`, `frontend/.gitignore`, untracked `scripts/` data-prep files) must be left untouched. **Every task `git add`s only the exact files it names — never `git add .`.**

---

### Task 1: Render Blueprint (`render.yaml`) + local proof of the deploy commands

Create the Render Blueprint and prove locally that its exact build + boot commands work (deps install, app imports, `/health` responds). This de-risks the Render build before any dashboard step.

**Files:**
- Create: `render.yaml` (repo root)
- Verify (no commit): a throwaway venv under `backend/.venv-smoke` (deleted at the end)

**Interfaces:**
- Produces: a Render Blueprint that Track A / the user runbook consumes; the health endpoint `GET /health` → `{"status":"ok"}` (already defined in `backend/wastewise/api.py`).

- [ ] **Step 1: Write `render.yaml`**

```yaml
# Render Blueprint for the WasteWise backend (Track A — permanent public API).
# Deploy: Render Dashboard -> New -> Blueprint -> pick this repo. Enter the
# sync:false secrets when prompted. See docs/DEPLOY.md.
services:
  - type: web
    name: wastewise-backend
    runtime: python
    rootDir: backend
    plan: free
    buildCommand: pip install -e .
    startCommand: uvicorn wastewise.api:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: "3.12"
      - key: LLM_BASE_URL
        value: https://api.fireworks.ai/inference/v1
      - key: LLM_MODEL
        value: accounts/fireworks/models/llama-v3p1-8b-instruct
      - key: LLM_API_KEY
        sync: false
      - key: USDA_API_KEY
        sync: false
      - key: KROGER_CLIENT_ID
        sync: false
      - key: KROGER_CLIENT_SECRET
        sync: false
```

- [ ] **Step 2: Prove the build command installs the backend cleanly**

Run (Git Bash, from repo root):
```bash
cd backend
python -m venv .venv-smoke
source .venv-smoke/Scripts/activate
pip install -e .
```
Expected: install completes with `Successfully installed ... wastewise-0.1.0` and no error. This is the exact `buildCommand` Render will run.

- [ ] **Step 3: Prove the app boots and `/health` responds (keyless)**

Run (same activated venv):
```bash
python -c "from fastapi.testclient import TestClient; from wastewise.api import app; print(TestClient(app).get('/health').json())"
```
Expected output: `{'status': 'ok'}` — confirms all deps import and the app serves with no `.env`/keys (the LLM-optional guarantee).

- [ ] **Step 4: Clean up the throwaway venv**

Run:
```bash
deactivate
rm -rf .venv-smoke
cd ..
```
Expected: `backend/.venv-smoke` is gone; `git status` shows only the new `render.yaml` as untracked (no venv artifacts).

- [ ] **Step 5: Commit**

```bash
git add render.yaml
git commit -m "chore: add Render blueprint for backend deployment"
```

---

### Task 2: Master deployment + verification runbook (`docs/DEPLOY.md`)

The single authoritative runbook the user follows to deploy both tracks and prove the live site is real. READMEs (Task 3) will point here.

**Files:**
- Create: `docs/DEPLOY.md`

**Interfaces:**
- Consumes: `render.yaml` (Task 1); `scripts/amd_setup.sh` (Task 4); `scripts/prepare_dataset.py` (already in repo working tree / `chore/data-prep-scripts`).
- Produces: the operator runbook referenced by both READMEs and the design spec.

- [ ] **Step 1: Write `docs/DEPLOY.md`**

````markdown
# WasteWise Deployment & Verification Runbook

Two deployments of the same backend. **Track A** is the permanent public link;
**Track B** is the AMD-GPU compute for the demo video and AMD credit.

## Track A — Render (permanent, always-on)

1. Push this branch and merge to `main` (Render deploys from a branch).
2. Render Dashboard → **New → Blueprint** → select the `wastewise` repo → apply
   `render.yaml`. It creates the `wastewise-backend` web service.
3. When prompted for the `sync:false` secrets, enter:
   - `LLM_API_KEY` = your Fireworks API key
   - `USDA_API_KEY`, `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` = optional (leave
     blank to use graceful fallbacks).
4. Wait for the build (`pip install -e .`) and first deploy to go green. Note the
   service URL, e.g. `https://wastewise-backend.onrender.com`.
5. Smoke it: `curl https://wastewise-backend.onrender.com/health` → `{"status":"ok"}`.

**Free-tier caveats (expected, not bugs):**
- The instance **sleeps after ~15 min idle**; the first request then cold-starts
  ~30–60s. Hit the URL once to warm it before demoing.
- The filesystem is **ephemeral** — uploaded datasets (SQLite) don't survive a
  restart/redeploy. Fine: the demo uploads a fresh CSV each run, then forecasts.

## Wire the permanent frontend (Vercel production)

1. Vercel → the frontend project → **Settings → Environment Variables**.
2. Set `NEXT_PUBLIC_API_URL = https://wastewise-backend.onrender.com` for
   **Production**.
3. **Redeploy production** (the var is build-time). The live site now calls the
   real backend.

## Track B — AMD box (vLLM on the Radeon PRO W7900)

1. Open the AMD Developer Cloud notebook (notebooks.amd.com/hackathon) on the
   **ROCm 7.2 + vLLM + PyTorch** image. Launcher → Other → **Terminal**.
2. Run the setup + probe helper:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/lostpay/wastewise/main/scripts/amd_setup.sh -o amd_setup.sh
   bash amd_setup.sh
   ```
   (Or `git clone` first, then `bash scripts/amd_setup.sh`.) It clones/installs the
   backend, prints the GPU probe, downloads `cloudflared`, and echoes the three
   launch commands.
3. Run the three printed commands in three terminals: `vllm serve` (LLM on GPU),
   `uvicorn` (backend → local vLLM), `cloudflared tunnel` (public URL).
4. Copy the `https://<...>.trycloudflare.com` URL into a Vercel **Preview**
   deployment's `NEXT_PUBLIC_API_URL` and redeploy that preview — an AMD-backed URL
   that leaves production untouched.

## End-to-end verification (both tracks)

1. Prepare a real dataset (from repo root, once):
   ```bash
   python scripts/prepare_dataset.py <kaggle_pizza_sales.csv> -o wastewise_sales.csv
   ```
2. Open the live site (production for Track A, or the preview for Track B).
3. **Setup** → upload `wastewise_sales.csv` → confirm a real dataset summary
   (row count / item names from YOUR file, not the demo's cabbage/chicken/pork).
4. **Forecast** → confirm numbers differ from the demo fixtures; on Track B the
   reasons come from the W7900 (watch `rocm-smi` show GPU util > 0 during the call).
5. **Sourcing** → confirm a price table with a non-zero savings line.
6. **Order** → confirm the PO table renders and CSV export downloads.

If a call ever silently returns the demo fixture, the backend was unreachable or
returned 5xx — check `curl <url>/health` and the server logs.
````

- [ ] **Step 2: Verify internal links resolve**

Run:
```bash
grep -nE 'render.yaml|scripts/amd_setup.sh|scripts/prepare_dataset.py|/health' docs/DEPLOY.md
```
Expected: matches for each referenced path (render.yaml exists from Task 1; the scripts are created in Task 4 / already present). No broken references to files this plan never creates.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: add deployment and verification runbook"
```

---

### Task 3: Point both READMEs at the runbook (+ Hosted URL slot)

Small, focused edits so a reader lands on the runbook and there's a home for the live URLs.

**Files:**
- Modify: `backend/README.md` (add a `## Deployment` section)
- Modify: `frontend/README.md` (add a `## Hosted` section)

**Interfaces:**
- Consumes: `docs/DEPLOY.md` (Task 2).

- [ ] **Step 1: Add a Deployment section to `backend/README.md`**

Append to `backend/README.md`:
```markdown

## Deployment
Permanent API on Render via `render.yaml` (Track A, Fireworks LLM); AMD-GPU
compute via vLLM on the notebook (Track B). Full steps, env vars, and free-tier
caveats: [`../docs/DEPLOY.md`](../docs/DEPLOY.md).

Hosted API: `https://wastewise-backend.onrender.com` <!-- update if the URL differs -->
```

- [ ] **Step 2: Add a Hosted section to `frontend/README.md`**

Append to `frontend/README.md`:
```markdown

## Hosted
- Live app (Vercel production → Render backend): `<paste production URL>`
- AMD-backed preview (Vercel preview → W7900 vLLM tunnel): `<paste preview URL, when running>`

Wiring `NEXT_PUBLIC_API_URL` and verifying a real end-to-end run:
[`../docs/DEPLOY.md`](../docs/DEPLOY.md).
```

- [ ] **Step 3: Verify the sections render as intended**

Run:
```bash
grep -nE '## Deployment|## Hosted|docs/DEPLOY.md' backend/README.md frontend/README.md
```
Expected: the new headings and the `docs/DEPLOY.md` link appear in the right files.

- [ ] **Step 4: Commit**

```bash
git add backend/README.md frontend/README.md
git commit -m "docs: link READMEs to deployment runbook and hosted URLs"
```

---

### Task 4: AMD Track-B automation (`scripts/amd_setup.sh`)

An idempotent helper for the AMD Jupyter terminal: clone/update, install, probe the GPU, fetch `cloudflared`, and print the exact three launch commands. Keeps Track B fast and repeatable across session resets.

**Files:**
- Create: `scripts/amd_setup.sh`

**Interfaces:**
- Consumes: the backend package (`pip install -e .`), vLLM/torch from the ROCm image.
- Produces: printed launch commands for `vllm serve`, `uvicorn`, and `cloudflared` used by `docs/DEPLOY.md` Track B.

- [ ] **Step 1: Write `scripts/amd_setup.sh`**

```bash
#!/usr/bin/env bash
# WasteWise — AMD Developer Cloud (notebooks.amd.com/hackathon) Track-B setup.
# Run in the JupyterLab Terminal on the ROCm 7.2 + vLLM + PyTorch image.
# Clones/installs the backend, probes the GPU, fetches cloudflared, and prints
# the exact launch commands. Safe to re-run.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/lostpay/wastewise.git}"
MODEL="${MODEL:-meta-llama/Llama-3.1-8B-Instruct}"
VLLM_PORT="${VLLM_PORT:-8000}"
API_PORT="${API_PORT:-8080}"
WORKDIR="${WORKDIR:-$HOME/wastewise}"

echo "==> 1/4 clone / update repo"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" pull --ff-only || echo "(pull skipped)"
else
  git clone "$REPO_URL" "$WORKDIR"
fi

echo "==> 2/4 install backend (editable)"
cd "$WORKDIR/backend"
pip install -q -e .

echo "==> 3/4 GPU probe"
rocm-smi --showproductname --showmeminfo vram || echo "rocm-smi not found"
python - <<'PY'
import torch
ok = torch.cuda.is_available()
print("gpu_available:", ok)
if ok:
    print("device:", torch.cuda.get_device_name(0))
    print("vram_GB:", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1))
try:
    import vllm
    print("vllm:", vllm.__version__)
except Exception as e:
    print("vllm import failed:", e)
PY

echo "==> 4/4 download cloudflared (if missing)"
if [ ! -x "$WORKDIR/cloudflared" ]; then
  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O "$WORKDIR/cloudflared"
  chmod +x "$WORKDIR/cloudflared"
fi

cat <<EOF

============================================================
Setup complete. Run these in THREE separate terminals:

[1] Serve the LLM on the AMD GPU:
    cd $WORKDIR/backend && vllm serve $MODEL --port $VLLM_PORT

[2] Run the backend (LLM -> local vLLM):
    cd $WORKDIR/backend && \\
    LLM_BASE_URL=http://localhost:$VLLM_PORT/v1 LLM_MODEL=$MODEL LLM_API_KEY=dummy \\
    uvicorn wastewise.api:app --host 0.0.0.0 --port $API_PORT

[3] Expose the backend publicly:
    $WORKDIR/cloudflared tunnel --url http://localhost:$API_PORT

Then put the https://<...>.trycloudflare.com URL into a Vercel PREVIEW
deployment's NEXT_PUBLIC_API_URL. CORS is already open (allow_origins=["*"]).
============================================================
EOF
```

- [ ] **Step 2: Syntax-check the script**

Run (from repo root):
```bash
bash -n scripts/amd_setup.sh && echo "syntax OK"
```
Expected: `syntax OK` (no parse errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/amd_setup.sh
git commit -m "chore: add AMD notebook setup script for vLLM backend"
```

---

### Task 5: Flesh out `docs/AMD_USAGE.md` (commands + benchmark + paste markers)

The existing file has the narrative and a screenshot placeholder. Add the exact serve command, the local-vLLM wiring, a benchmark section, and explicit paste markers so the user can drop in real evidence after running Track B. Keep the existing narrative paragraph.

**Files:**
- Modify: `docs/AMD_USAGE.md`

**Interfaces:**
- Consumes: `scripts/amd_setup.sh` (Task 4), Track B launch commands.

- [ ] **Step 1: Replace the screenshot-placeholder tail with a fuller evidence section**

In `docs/AMD_USAGE.md`, keep lines 1–9 (the narrative through the `vllm serve <model>` line) and replace everything from "Insert a screenshot of `rocm-smi`..." to the end with:

```markdown
## Reproduce

On the AMD Developer Cloud notebook (ROCm 7.2 + vLLM image), from a terminal:

    bash scripts/amd_setup.sh          # clone + install + GPU probe + cloudflared
    vllm serve meta-llama/Llama-3.1-8B-Instruct --port 8000   # LLM on the W7900
    LLM_BASE_URL=http://localhost:8000/v1 LLM_MODEL=meta-llama/Llama-3.1-8B-Instruct \
      LLM_API_KEY=dummy uvicorn wastewise.api:app --host 0.0.0.0 --port 8080

Both LLM judgment steps (`agents/adjustment.py`, `agents/sourcing.py`) then run
their `chat.completions` calls against vLLM on the AMD GPU.

## Evidence

`rocm-smi` with the model resident on the W7900 (VRAM in use, GPU util > 0):

```
<paste `rocm-smi` output here>
```

vLLM server log line naming the ROCm device / loaded model:

```
<paste the vLLM startup log line here>
```

## Benchmark

Latency for one forecast-adjustment generation on the W7900 (vLLM):

| metric | value |
|---|---|
| model | meta-llama/Llama-3.1-8B-Instruct |
| prompt (adjustment step) | ~<n> tokens |
| output tokens | ~<n> |
| end-to-end latency | <paste> ms |
| throughput | <paste> tok/s |

Capture with a stopwatch on the `/forecast` call, or vLLM's own `--disable-log-stats`
off (default) server metrics.

_Screenshots: attach the JupyterLab terminal + `rocm-smi` panel below._
```

- [ ] **Step 2: Verify the file still contains the narrative and the new sections**

Run:
```bash
grep -nE 'Radeon PRO W7900|## Reproduce|## Evidence|## Benchmark|amd_setup.sh' docs/AMD_USAGE.md
```
Expected: the original W7900 narrative plus the three new headings and the script reference all present.

- [ ] **Step 3: Commit**

```bash
git add docs/AMD_USAGE.md
git commit -m "docs: expand AMD usage with repro commands and benchmark template"
```

---

## User Deployment Runbook (runs after this plan's artifacts exist)

The plan above produces the artifacts and proves the commands locally. These final
steps are interactive (accounts / dashboards / the AMD notebook) and are the user's
to run — all detailed in `docs/DEPLOY.md`:

1. Push `chore/deploy` and merge to `main`.
2. Render: New → Blueprint → apply `render.yaml`; enter the Fireworks `LLM_API_KEY`.
3. Vercel: set production `NEXT_PUBLIC_API_URL` to the Render URL; redeploy.
4. Verify Track A end-to-end on the live site with a prepared CSV.
5. AMD notebook: `bash scripts/amd_setup.sh` → run the three printed commands →
   tunnel URL → optional Vercel preview.
6. Fill `docs/AMD_USAGE.md` Evidence/Benchmark with real `rocm-smi` output + numbers.

## Self-Review

- **Spec coverage:** Track A Render config (Task 1) ✔; free-tier caveats + Vercel prod wiring (Task 2) ✔; Track B vLLM/tunnel automation (Task 4) ✔; frontend wiring incl. AMD preview (Tasks 2–3) ✔; AMD_USAGE.md evidence+benchmark (Task 5) ✔; verification runbook (Task 2) ✔; sequencing/risks captured in DEPLOY.md + this plan ✔. No source-code changes anywhere ✔.
- **Placeholders:** the only `<paste ...>` / `<n>` tokens are deliberate fill-in slots for runtime evidence (URLs, rocm-smi output, benchmark numbers), not unfinished plan steps.
- **Type/name consistency:** ports (vLLM 8000 / API 8080), model id (`meta-llama/Llama-3.1-8B-Instruct`), env keys (`LLM_BASE_URL`/`LLM_MODEL`/`LLM_API_KEY`), and `/health` are used identically across `render.yaml`, `amd_setup.sh`, `DEPLOY.md`, and `AMD_USAGE.md`.
