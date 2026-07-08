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
    cd $WORKDIR/backend && \
    LLM_BASE_URL=http://localhost:$VLLM_PORT/v1 LLM_MODEL=$MODEL LLM_API_KEY=dummy \
    uvicorn wastewise.api:app --host 0.0.0.0 --port $API_PORT

[3] Expose the backend publicly:
    $WORKDIR/cloudflared tunnel --url http://localhost:$API_PORT

Then put the https://<...>.trycloudflare.com URL into a Vercel PREVIEW
deployment's NEXT_PUBLIC_API_URL. CORS is already open (allow_origins=["*"]).
============================================================
EOF
