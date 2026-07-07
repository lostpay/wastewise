# WasteWise Backend

## AMD compute usage
LLM inference for both agent steps runs on an AMD Radeon PRO W7900 (48 GB VRAM,
RDNA3/gfx1100) via vLLM (ROCm), served with an OpenAI-compatible endpoint, on the
AMD Developer Cloud notebook (notebooks.amd.com/hackathon). Set `LLM_BASE_URL` to
the vLLM endpoint for submission. See `docs/AMD_USAGE.md` for the `rocm-smi` / vLLM
endpoint screenshots.
