# WasteWise Deployment & Verification Runbook

Two deployments of the same backend. **Track A** is the permanent public link;
**Track B** is the AMD-GPU compute for the demo video and AMD credit.

## Track A — Render (permanent, always-on)

1. Push this branch and merge to `main` (Render deploys from a branch).
2. Render Dashboard → **New → Blueprint** → select the `wastewise` repo → apply
   `render.yaml`. It creates the `wastewise-backend` web service.
3. When prompted for the `sync:false` secrets, enter:
   - `LLM_API_KEY` = your Fireworks API key
   - `FRED_API_KEY`, `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` = optional (leave
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
