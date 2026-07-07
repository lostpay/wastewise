# AMD Compute Usage

WasteWise runs both LLM judgment steps (demand adjustment + sourcing notes) on an
open model served by **vLLM on an AMD Radeon PRO W7900 (48 GB VRAM, RDNA3/gfx1100,
ROCm)** via an OpenAI-compatible endpoint, on the AMD Developer Cloud notebook
(notebooks.amd.com/hackathon). Set `LLM_BASE_URL` to the vLLM endpoint at submission
time. Serve with (pick a 7B–14B instruct model that fits 48 GB):

    vllm serve <model> --port 8000

Insert a screenshot of `rocm-smi` showing the model resident on the W7900 (VRAM in
use, GPU util > 0) and a screenshot of the vLLM server log naming the ROCm device,
below this line.
