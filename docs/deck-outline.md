# WasteWise — Slide Deck Outline

Target: 8 slides, PDF export. The pre-screener reads this deck for the AMD usage
claim — slide 6 is the hard gate; everything else is for the human judges.
Keep text sparse: one idea per slide, screenshots over bullets.

---

## Slide 1 — Title

- **WasteWise** — AI purchasing assistant for restaurants
- One-liner: *Predicts ingredient demand, benchmarks supplier costs against live market data, and drafts the purchase order — cutting over-ordering and food waste.*
- Hosted URL + repo URL (visible, not tiny)
- AMD Developer Hackathon: ACT II — Unicorn track

## Slide 2 — Problem

- Restaurants over-order because purchasing is a gut call: last week's numbers, no weather, no price comparison.
- US restaurants generate ~11.4 M tons of food waste per year (~$25 B in food costs). Cite the source (ReFED). One big number, one sentence.
- Over-ordering is the one waste driver software can remove *before* the food is bought.

## Slide 3 — Solution: the loop

- Diagram: `sales history → forecast → agent adjusts & explains → agent sources & prices → drafted PO → human approves`
- Emphasize: the human approves; the AI drafts and *shows its reasoning at every step*.
- Screenshot strip of the 4 screens (Setup → Forecast → Sourcing → Order).

## Slide 4 — The agent's decision-making (the star)

Walk ONE item through the chain, with real UI crops:

1. Forecast says 120 units of stew meat.
2. Adjustment agent: rain forecast Thursday → comfort-food demand up → 134, with the on-screen reason.
3. Sourcing agent: picks the plain-commodity listing over a marinated one, under the US retail average — "AI picked this" badge + its stated reason.
4. Order page: agent-written purchasing rationale above the Approve button.

- Bullet: every AI output carries a `live` flag — when the model is down, the UI says "AI reasoning unavailable" instead of faking it. No scripted answers.

## Slide 5 — Measured, not asserted

- Forecast is backtested on a 7-day holdout: **XGBoost beats the seasonal baseline by ~24% MAE** on the demo dataset — computed at runtime, shown on screen.
- Sourcing savings vs. the BLS/FRED retail benchmark: the demo PO shows a real dollar figure.
- Engineering posture: 121 automated tests (78 backend / 43 frontend), schema-validated LLM output, graceful fallback at every external dependency.

## Slide 6 — AMD compute (the mandatory claim — state it verbatim)

> **Both LLM agent steps run inference on vLLM on an AMD Radeon PRO W7900 (48 GB, RDNA3/gfx1100, ROCm) on the AMD Developer Cloud.**

- Embed the `rocm-smi` screenshot: ~43.6 GiB of 48 GiB VRAM in use with Mistral-7B-Instruct-v0.3 resident.
- Embed the vLLM server log line (`Using Triton Attention backend`, ROCm device).
- One line: OpenAI-compatible endpoint — `LLM_BASE_URL` is the only switch between dev and the AMD GPU.
- Latency table from docs/AMD_USAGE.md once filled in (tok/s, end-to-end ms).

## Slide 7 — Architecture

- The diagram from the README (Next.js/Vercel → FastAPI → vLLM on W7900).
- Three design choices, one line each:
  - Structured pipeline, LLM only at judgment points — a purchasing agent that hallucinates a tool call drafts a wrong order.
  - Swappable data adapters (NOAA, US holidays, FRED/BLS, Kroger) — market-agnostic by construction.
  - The demo must not break: cache → fallback → honest labeling.

## Slide 8 — Roadmap + ask

- v2: waste-photo feedback loop (vision model closes the loop on actual waste), recipe/BOM layer for full-service menus, deep-learning forecaster on AMD GPUs.
- Who it serves today: counter-service, cafés, grocery-adjacent kitchens — operations that already buy at the item level.
- Close with the loop diagram + hosted URL again.

---

## Production notes

- Export as PDF (submission requirement). Any tool works; keep fonts embedded.
- Slide 6's claim must name the **W7900** — the rocm-smi output says gfx1100, and an
  MI300X claim against gfx1100 evidence looks copy-pasted. Keep the GPU name
  consistent across deck, README, and AMD_USAGE.md.
- Reuse the video's screen recordings as slide 4's crops — capture once, use twice.
- All text in English (all-tracks rule).
