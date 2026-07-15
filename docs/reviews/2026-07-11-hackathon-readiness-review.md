# WasteWise — Hackathon Readiness Review

**Date:** 2026-07-11 (deadline day, 15:00 UTC)
**Scope:** idea quality, implementation completeness, submission-package readiness, and the framing fixes for the known weaknesses.

**TL;DR: The idea is strong and the code is genuinely done — but as of this review the submission would fail pre-screening.** The demo video, slide deck, and AMD screenshots don't exist, and the hosted backend is suspended. Everything left is packaging work, not engineering.

---

## 1. The idea — strong fit for the Unicorn track

The pitch is clean and judgeable in 90 seconds: upload sales history → forecast demand → an LLM agent adjusts for weather/holidays with plain-language reasons → a second agent benchmarks prices and drafts a purchase order a human approves. It hits all three judging axes — practically useful (food waste is a real, relatable cost), technically impressive (XGBoost + baseline backtest, four real data adapters, three LLM agents), and innovative enough (reasoning-with-receipts: every adjustment carries a live AI explanation).

The engineering judgment behind it is the strongest part:

- "Structured pipeline, not free-roaming autonomy" is exactly right for a demo that must not break.
- The OpenAI-compatible client makes vLLM/AMD a one-line env swap — de-risks the disqualification gate.
- Demo-mode fallback, per-item parallelized adjustment calls (structurally prevents copy-paste reasoning across items), the `live` flag distinguishing real AI output from fallback text, and two demo datasets (one tuned to actually show `baseline_delta` ≈ 0.24) all show the demo being treated as a product.

### Honest weaknesses, and how to counter them

**Weakness 1 — item-level forecasting without recipe/BOM mapping.** The fix is narrative, and the substance already exists: the sourcing demo dataset (cabbage/chicken/pork) is *ingredients*, not dishes.

- In the deck and video, name who it serves today: counter-service, cafés, grocery-adjacent kitchens — operations that already purchase at the item level. For them the loop is complete end-to-end.
- Make the BOM layer the roadmap slide: "v2 adds dish→ingredient rollup for full-service restaurants." A named, scoped v2 reads as vision; an unmentioned hole reads as an oversight.
- Use the sourcing dataset in the video so every on-screen item is a purchasable ingredient.

**Weakness 2 — "it's a fixed pipeline, not a real agent."** Own the choice, and surface the autonomy already built:

- One deck line: deterministic tool dispatch + LLM judgment at the decision points, schema-validated and human-approved, *because a purchasing agent that hallucinates a tool call drafts a wrong order.* Free-roaming autonomy is the v2 experiment.
- The sourcing agent already *selects among candidate offers* and explains the pick ("AI picked this"). Selection-among-options is the most legible form of agency — dwell on it in the video, show the alternatives it rejected.
- Narrate one item's full decision chain in the 90 seconds: rain → stew adjusted up with a weather-specific reason → sourcing picks listing X over the benchmark with a stated justification → rationale card on the Order page.
- The `live` flag is a sleeper differentiator: "when the model is unreachable, we say so on-screen — we never fake reasoning." Directly serves the no-hardcoded-answers rule.

Do **not** build new surface area on deadline day (agent-trace panel, tool-calling, horizon calendar) — it only adds ways for the demo to break.

---

## 2. Implementation completeness — verified done

- Backend: **78/78 tests passing** (run 2026-07-10). Ingestion, XGBoost + baseline with holdout delta, NOAA/holidays/FRED/Kroger adapters with caching and graceful fallbacks, three LLM agents (adjustment, sourcing selection, rationale), FastAPI endpoints with input hardening.
- Frontend: **43/43 tests passing.** Four-screen wizard, sessionStorage state with corrupt-state recovery, demo-mode fallback, live/AI badges, CSV export.
- Frontend deployed and READY at `wastewise-theta.vercel.app` (verified via the Vercel API; production deploy from 2026-07-10).

---

## 3. Submission package — the emergency

| Deliverable | Status at review time |
|---|---|
| Public repo + MIT license | ✅ Done |
| Demo video (~90 s) | ❌ Does not exist |
| Slide deck (PDF) | ❌ Does not exist — pre-screening reads it for the AMD claim; hard gate |
| `rocm-smi` / vLLM screenshots | ❌ Text pasted in AMD_USAGE.md, zero image files committed |
| Hosted backend | ❌ Render responds "This service has been suspended by its owner" — the live site silently falls to demo data |
| Benchmark table | ❌ Literal `<paste>` placeholders in AMD_USAGE.md |

Repo-hygiene issues that matter because pre-screening inspects the repo, not the video:

- **No root README** (fixed this session — verify content and commit). The AMD claim was buried in `backend/README.md` and `docs/AMD_USAGE.md`.
- Unpushed doc commits and untracked files (`docs/AMD_RUNBOOK.md` was not on GitHub).
- **MI300X vs W7900 inconsistency:** the spec and STATUS.md say MI300X; the actual rocm-smi evidence is a Radeon PRO W7900 (gfx1100). Still AMD compute — but deck, README, and AMD_USAGE.md must name the same GPU as the evidence.

## 4. Priority order for the remaining hours

1. **Un-suspend/redeploy the Render backend**, confirm `/health`.
2. **Boot vLLM on the AMD box with `LLM_REQUIRE_LIVE=true`**, run one real `/forecast`, confirm reasons are live (not the fallback string). Take the actual PNG screenshots and fill the benchmark table while it's up.
3. **Record the 90 s video** against the spec §12 beat sheet while the live stack is running.
4. **Build the slide deck PDF** (outline at `docs/deck-outline.md`) — the AMD slide states the W7900/vLLM/ROCm claim verbatim with the rocm-smi screenshot embedded.
5. **Commit the root README + screenshots + AMD_RUNBOOK.md, push everything.**
6. Skip the horizon calendar picker.

## 5. Raising the human-judge score (after the gate is passed)

- Put a measured number in the first 15 seconds: ~24% MAE improvement over baseline from a real holdout backtest, and the computed savings figure. Measured beats hypothetical.
- Label demo mode visibly at the hosted URL — unlabeled canned data looks like exactly the hardcoded-answers behavior the rules ban.
- One GPU name everywhere.
- Root README structured for the machine and the skimming judge: pitch → AMD section with screenshot → hosted URLs → deck/video links → architecture.

## Verdict

As an engineering artifact this is well above typical hackathon quality — tested, deployed, thoughtfully de-risked. The two idea-level weaknesses are survivable with framing writable in an hour, because the substance behind each already exists in the code (ingredient-level data; LLM candidate selection). The submission lives or dies on the packaging items above, with the suspended backend and the live-LLM verification as the two that can't slip.
