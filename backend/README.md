# WasteWise Backend

## AMD compute usage
LLM inference for both agent steps runs on an AMD Radeon PRO W7900 (48 GB VRAM,
RDNA3/gfx1100) via vLLM (ROCm), served with an OpenAI-compatible endpoint, on the
AMD Developer Cloud notebook (notebooks.amd.com/hackathon). Set `LLM_BASE_URL` to
the vLLM endpoint for submission. See `docs/AMD_USAGE.md` for the `rocm-smi` / vLLM
endpoint screenshots.

## Run locally
    pip install -e ".[dev]"
    cp .env.example .env   # fill in keys; point LLM_BASE_URL at vLLM or Fireworks
    uvicorn wastewise.api:app --reload
Tests: `pytest -q`

## Deployment
Permanent API on Render via `render.yaml` (Track A, Fireworks LLM); AMD-GPU
compute via vLLM on the notebook (Track B). Full steps, env vars, and free-tier
caveats: [`../docs/DEPLOY.md`](../docs/DEPLOY.md).

Hosted API: `https://wastewise-backend.onrender.com` <!-- update if the URL differs -->
