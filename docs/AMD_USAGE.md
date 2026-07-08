# AMD Compute Usage

WasteWise runs both LLM judgment steps (demand adjustment + sourcing notes) on an
open model served by **vLLM on an AMD Radeon PRO W7900 (48 GB VRAM, RDNA3/gfx1100,
ROCm)** via an OpenAI-compatible endpoint, on the AMD Developer Cloud notebook
(notebooks.amd.com/hackathon). Set `LLM_BASE_URL` to the vLLM endpoint at submission
time. Serve with (pick a 7B–14B instruct model that fits 48 GB):

    vllm serve <model> --port 8000

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
