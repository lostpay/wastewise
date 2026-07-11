# WasteWise — Demo Video Script (~2:45–3:00, narrative cut)

Structure: **problem → why it's hard → how the AI solves it → why it matters.**
That's the arc judges remember; the feature list is secondary.

A shorter (~90s) beats-only cut is preserved in git history
(`git log -- docs/video-script.md`) in case the actual submission rule turns out
to cap runtime — check the portal before committing to this length.

**Every number spoken on screen must be the number the live app actually shows
at record time** — the compliance rule bars faked/hardcoded answers, and an
invented dollar figure that doesn't match the on-screen total is the one thing
that would visibly violate it. Where this script says "state the real figure,"
that's not filler — read the number off the screen as you record.

Record against the **live stack** (`LLM_REQUIRE_LIVE=true`, vLLM up on the AMD
box). If a reason shown on screen is the fallback string instead of a live one,
stop and fix the stack before recording — a canned-sounding reason undercuts the
"AI explains why" pitch you're making in the same breath.

---

## 0:00–0:20 — Opening: the problem

**Screen:** No kitchen b-roll exists in this repo, and there's no time to shoot
one on deadline day — two honest options:
- **Fast path:** 3–4 clips of free stock footage (Pexels/Pixabay, restaurant
  kitchen / busy service / a manager checking a clipboard) — searchable and
  downloadable in minutes, no attribution required on those two sites.
- **No-footage path:** open on the three problem words as clean text cards
  (see below) over a dark background — no stock footage needed at all. Faster,
  and still lands the message.

**Narration:**
"Every day, restaurant owners face the same decision: how much to order, and
where to buy it. Order too much, and food goes to waste. Order too little, and
you run out mid-service."

**Flash text cards:** Food Waste · Stock Shortages · High Costs

## 0:20–0:35 — Why it's hard

This beat is easy to skip by accident — don't. It's what makes "we built a
forecasting tool" sound like a hard problem instead of a checkbox.

**Screen:** stay on the text-card / stock footage, or cut to a blank
spreadsheet-like visual (optional).
**Narration:**
"It's not just guesswork — the right order depends on last week's sales,
tomorrow's weather, upcoming holidays, and which supplier is cheapest *today*.
Juggling all of that by hand, every week, for every ingredient, doesn't scale."

## 0:35–0:50 — Introduce WasteWise

**Screen:** Landing page, zoom toward the setup screen.
**Narration:**
"Meet WasteWise — an AI purchasing assistant that forecasts demand, compares
supplier prices, and drafts the order for you."

## 0:50–1:05 — Demo: Setup

**Screen:** Setup page. The "Use demo dataset" shortcut button has been removed
— drag-and-drop the bundled `backend/wastewise/data/demo_sales.csv` onto the
dropzone on screen (have the file ready on the desktop beforehand so this is a
clean single motion, not a file-picker hunt), pick location, pick horizon.
**Narration:**
"Upload your sales history. Pick a location; that drives regional weather and
pricing."

## 1:05–1:35 — Demo: Forecast (the AI explains why)

**Screen:** Forecast page. Chart on screen with the backtest delta visible.
Highlight one real line item from the bundled dataset — **cabbage, pork, or
chicken** (that's what's actually in `demo_sales.csv`; don't invent an item
that isn't in the data).
**Narration:**
"XGBoost forecasts next week's demand for each ingredient — beating a seasonal
baseline by [state the real backtest % shown on screen] on a holdout test."

Point at the on-screen adjustment reason as you say the next line:
"Then the AI adjusts for real conditions — here, [read the actual weather/
holiday reason the model gives for the highlighted item] — and shows *why*,
not just a new number."

"The AI doesn't just predict — it explains itself."

## 1:35–2:05 — Demo: Smart Sourcing (the star beat)

**Screen:** Sourcing page. Show the candidate listings for one item — both the
plain-commodity option and a pricier alternative — then the "AI picked this"
badge and its stated reason.
**Narration:**
"Next, WasteWise checks live supplier prices against the market benchmark."

Point at the rejected alternative, then the pick:
"Instead of manually comparing listings, the agent picks the best option
itself — here it passed over [the pricier listing] for [the cheaper one],
under the benchmark — and says why."

Mouse over the savings figure: "[state the real savings figure on screen]
saved on this order alone."

## 2:05–2:25 — Demo: Purchase Order

**Screen:** Order page — line totals, total, savings vs. benchmark, the
agent-written rationale above Approve. Click Approve → Export CSV on screen.
**Narration:**
"Finally, a complete purchase order — quantities, supplier, and the AI's own
purchasing rationale. The manager reviews, approves, and exports. A human is
always the last step — the AI drafts, it doesn't decide alone."

## 2:25–2:45 — How it works

**Screen:** Clean animated diagram, no slides:

```
Historical Sales
      ↓
Machine Learning (XGBoost)
      ↓
Demand Forecast  ←  Weather / Holidays
      ↓
Supplier Prices  →  LLM Agent
      ↓
Purchase Recommendation
```

**Narration:**
"Under the hood: XGBoost forecasts demand, and an LLM agent reasons over that
forecast, live weather, and supplier prices to recommend the purchase. The
pipeline calls tools deterministically — the model only makes the judgment
calls, and every judgment is checked against a schema before it reaches the
screen. That's what keeps an AI agent from drafting a nonsense order."

That last sentence is doing real work: it preempts "is this even a real agent?"
without sounding defensive about it.

## 2:45–2:55 — Why AMD

**Screen:** Not a generic AMD logo — use the actual evidence: a quick cut to
the `rocm-smi` terminal output (`docs/images/rocm-smi.png` / the live terminal)
showing the model resident on the GPU.
**Narration:**
"Both agent steps run inference on vLLM, on an AMD Radeon PRO W7900, right here
on the AMD Developer Cloud."

Name the exact GPU (W7900) — it has to match the deck and README verbatim, or
an MI300X-sounding claim against gfx1100 evidence reads as copy-pasted.

## 2:55–3:05 — Closing

**Screen:** Cut back to the approved Order page, then fade to the loop diagram
or title card.
**Narration:**
"Less waste. Lower costs. Smarter purchasing decisions — made with the AI
showing its work at every step."

**Title card:** WasteWise — Forecast. Source. Order. Smarter.

---

## Before hitting record

1. Render backend un-suspended, `/health` green.
2. vLLM live on the AMD box, one real `/forecast` call confirmed non-fallback
   (check the reason text isn't the seeded fallback string).
3. Have `backend/wastewise/data/demo_sales.csv` saved somewhere easy to
   drag onto the dropzone — there's no shortcut button anymore. Clear
   sessionStorage or use a private window so no stale state from a prior run
   leaks into the recording.
4. Watch the Forecast and Sourcing screens once *before* recording to know
   which real item, reason, and savings figure will actually appear — write
   those into the narration beats above instead of ad-libbing during the take.
5. Browser zoom / window size set so text reads clearly at 1080p.
6. Silence notifications, close other tabs.

## After recording

- Export, upload, drop the link into `README.md`'s
  `<!-- TODO: add video link -->` line.
- Reuse the Forecast/Sourcing clips as the deck's slide 4 crops (see
  `docs/deck-outline.md`) — capture once, use twice.
