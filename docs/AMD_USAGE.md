# AMD Compute Usage

> Before the final submission run: set `LLM_REQUIRE_LIVE=true` in the AMD
> box's env so the API refuses to boot on a dead vLLM endpoint instead of
> silently serving fallback text (see `backend/wastewise/config.py`). Also
> run `python -m wastewise.check_data_sources` once to confirm USDA/Kroger
> credentials are live before recording the demo video.

WasteWise runs both LLM judgment steps (demand adjustment + sourcing notes) on an
open model served by **vLLM on an AMD Radeon PRO W7900 (48 GB VRAM, RDNA3/gfx1100,
ROCm)** via an OpenAI-compatible endpoint, on the AMD Developer Cloud notebook
(notebooks.amd.com/hackathon). Set `LLM_BASE_URL` to the vLLM endpoint at submission
time. Serve with (pick a 7B–14B instruct model that fits 48 GB — note
`meta-llama/Llama-3.1-8B-Instruct` is a gated HF repo and will 401 without an
approved HF token; `mistralai/Mistral-7B-Instruct-v0.3` is open-access and used here):

    vllm serve mistralai/Mistral-7B-Instruct-v0.3 --port 8000

## Reproduce

On the AMD Developer Cloud notebook (ROCm 7.2 + vLLM image), from a terminal:

    bash scripts/amd_setup.sh          # clone + install + GPU probe + cloudflared
    vllm serve mistralai/Mistral-7B-Instruct-v0.3 --port 8000   # LLM on the W7900
    LLM_BASE_URL=http://localhost:8000/v1 LLM_MODEL=mistralai/Mistral-7B-Instruct-v0.3 \
      LLM_API_KEY=dummy uvicorn wastewise.api:app --host 0.0.0.0 --port 8080

Both LLM judgment steps (`agents/adjustment.py`, `agents/sourcing.py`) then run
their `chat.completions` calls against vLLM on the AMD GPU.

## Evidence

`rocm-smi` with the model resident on the W7900 (VRAM in use, GPU util > 0):

```
root@hf-97-8a4201d1:/workspace# rocm-smi --showproductname --showmeminfo vram

==================== ROCm System Management Interface ====================
========================== Memory Usage (Bytes) ===========================
GPU[0]          : VRAM Total Memory (B): 51522830336
GPU[0]          : VRAM Total Used Memory (B): 46856990720
=============================================================================
============================== Product Info ================================
GPU[0]          : Card Series:     N/A
GPU[0]          : Card Model:      0x744b
GPU[0]          : Card Vendor:     Advanced Micro Devices, Inc. [AMD/ATI]
GPU[0]          : Card SKU:        D7070910
GPU[0]          : Subsystem ID:    0x0e0c
GPU[0]          : Device Rev:      0x00
GPU[0]          : Node ID:         3
GPU[0]          : GUID:            49884
GPU[0]          : GFX Version:     gfx1100
==================== End of ROCm SMI Log ====================
```

VRAM: 51,522,830,336 B total (≈48 GiB) / 46,856,990,720 B used (≈43.6 GiB, ~91%)
with Mistral-7B-Instruct-v0.3 resident — confirms the model plus vLLM's KV cache
are actually loaded on the AMD GPU (`gfx1100` = RDNA3, matches the W7900).

vLLM server log line naming the ROCm device / loaded model:

```
(EngineCore_DP0 pid=633) INFO [rocm.py:377] Using Triton Attention backend.
(APIServer pid=100) INFO [api_server.py:486] Starting vLLM API server 0 on http://0.0.0.0:8000
```

Model load: `Using cache directory: /root/.cache/vllm/torch_compile_cache/...`,
KV cache size 373,344 tokens / 39.88 GiB available, max concurrency 9.11x,
`init engine (profile, create kv cache, warmup model) took 52.17 seconds`.

## Benchmark

Latency for one forecast-adjustment generation on the W7900 (vLLM):

| metric | value |
|---|---|
| model | mistralai/Mistral-7B-Instruct-v0.3 |
| prompt (adjustment step) | ~<n> tokens |
| output tokens | ~<n> |
| end-to-end latency | <paste> ms |
| throughput | <paste> tok/s |

Capture with a stopwatch on the `/forecast` call, or vLLM's own `--disable-log-stats`
off (default) server metrics.

_Screenshots: attach the JupyterLab terminal + `rocm-smi` panel below._
