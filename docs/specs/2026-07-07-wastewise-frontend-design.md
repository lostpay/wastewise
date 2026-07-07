# WasteWise Frontend Design (Plan 2 of 2)

> Companion to `docs/specs/2026-07-07-wastewise-design.md` (overall design) and
> `docs/plans/2026-07-07-wastewise-backend.md` (Plan 1, backend). This document
> specifies the **frontend** so it can be turned into a task-by-task
> implementation plan (Plan 2).

## Goal

Build the WasteWise web UI: a Next.js app of **four stepwise screens**
(Setup → Forecast & Adjustments → Sourcing → Purchase Order), each mapping to
one backend endpoint, that feels like a real product and doubles as the hosted
demo URL for the AMD Developer Hackathon (Unicorn track). Deploy it to Vercel.

**Out of scope for Plan 2** (handled in a later, non-code session near
submission): the slide deck (PDF) and the demo video. They are content
deliverables, not TDD-able code.

## Global constraints

- **Language of all UI copy and agent-surfaced text: English.** (Hackathon rule.)
- **Judged partly on product feel** — polish matters; avoid a templated look.
- **The hosted Vercel URL must walk the full flow even when the AMD Cloud
  backend is offline** (pre-screening inspects the URL). Achieved via a
  baked-in demo-mode fallback.
- **No auth for the MVP.** A `dataset_id` threads the calls.
- **Backend contract is fixed** (see API contract below) — the frontend adapts
  to it, not vice versa.
- **Commit messages: plain Conventional Commits, no AI-attribution trailer.**

## Tech stack

- **Next.js (App Router) + TypeScript**
- **Tailwind CSS** for styling
- **shadcn/ui** for polished, accessible primitives (Button, Card, Table,
  Badge, Input, Select, Switch, Skeleton)
- **Recharts** for the forecast charts
- **Vitest + React Testing Library** (jsdom) for tests, with the `api` module
  mocked (stub or MSW)
- **Vercel** for deployment, project rooted at `frontend/`

## Backend API contract (consumed, already built in Plan 1)

```
GET  /health   -> { "status": "ok" }
POST /upload   (multipart form field `file`: CSV)
               -> { dataset_id: string, summary: { dataset_id, n_rows, items[], start_date, end_date } }
POST /forecast { dataset_id, horizon: "day"|"week", location: "lat,lon" }
               -> { items: [{ item, forecast, adjusted_qty, reason }], baseline_delta: number }
POST /sourcing { items: [{ item, qty }], location: "lat,lon" }
               -> { lines: [{ item, qty, supplier, unit_price, line_total, note }],
                    total: number, savings: number }
```

`location` must be `"lat,lon"` (the backend validates this and returns 422
otherwise). `horizon` is `"day"` or `"week"`.

## Project layout

```
frontend/
  app/
    layout.tsx            # shell + <Stepper> + <WizardProvider>
    page.tsx              # redirects to /setup
    setup/page.tsx        # Screen 1  -> POST /upload
    forecast/page.tsx     # Screen 2  -> POST /forecast
    sourcing/page.tsx     # Screen 3  -> POST /sourcing
    order/page.tsx        # Screen 4  (derived client-side from sourcing result)
  components/
    stepper.tsx           # 4-step progress header
    forecast-chart.tsx    # Recharts series per item (baseline vs adjusted)
    price-table.tsx       # USDA benchmark vs Kroger retail, best highlighted
    po-table.tsx          # drafted PO with totals
    reason-badge.tsx      # adjustment reason chip
    stat-tile.tsx         # e.g. baseline-delta / savings callout
    (shadcn/ui primitives under components/ui/)
  lib/
    api.ts                # typed client for the 4 endpoints; reads NEXT_PUBLIC_API_URL
    demo.ts               # pre-captured JSON fixtures + demo-mode fallback logic
    store.tsx             # WizardProvider (React Context) + sessionStorage persistence
    csv.ts                # PO -> CSV string (pure, unit-testable)
    types.ts              # response types mirroring the backend contract
  __tests__/              # Vitest + RTL specs
  package.json, tsconfig.json, tailwind.config, vitest.config, etc.
  README.md               # run + deploy + AMD/backend note
```

## Screens

Each screen maps to one backend call; stepwise (not a single dashboard) so each
is a demo beat and independently testable.

1. **Setup** (`/setup` → `POST /upload`). Upload a sales CSV **or** click "Use
   demo dataset"; set `location` (default `40.7,-74.0`) and `horizon`
   (`day`/`week`). On success, store `dataset_id` + `summary`, enable Next.
2. **Forecast & Adjustments** (`/forecast` → `POST /forecast`). Per-item
   forecast chart; a baseline-vs-model stat tile driven by `baseline_delta`;
   each item shown as forecast → `adjusted_qty` with a **reason badge**.
3. **Sourcing** (`/sourcing` → `POST /sourcing`, items = the adjusted
   quantities). Per-item price table (supplier, unit price, `note`), best
   supplier highlighted; **savings** called out via a stat tile.
4. **Purchase Order** (`/order`, no endpoint — derived from the sourcing
   result). PO table (item, qty, supplier, unit price, line total, grand
   total) + justification; **Approve → Export CSV** (built by `lib/csv.ts`).
   The "real product" payoff.

## State & data flow

- `WizardProvider` (React Context) holds `location`, `horizon`, `datasetId`,
  `summary`, `forecast`, `sourcing`, persisted to `sessionStorage` so a refresh
  doesn't lose progress.
- Each screen reads what it needs, calls its endpoint via `lib/api.ts`, writes
  the result to the store, and unlocks the next step. Navigating to a later
  screen without the prerequisite state redirects back to the first incomplete
  step.
- Screen 4 needs no network — it renders from `sourcing`.

## Demo-mode fallback (robustness)

`lib/api.ts` targets the live backend at `NEXT_PUBLIC_API_URL`. It returns
pre-captured fixtures from `lib/demo.ts` when **any** of:

1. `NEXT_PUBLIC_API_URL` is unset, or
2. a "Demo mode" toggle is on (default on when no API URL is configured), or
3. a live call throws or times out.

Fixtures are a real captured `upload → forecast → sourcing` run on the bundled
demo dataset (cabbage/pork/chicken), so the hosted URL always completes the full
walkthrough. A live backend, when reachable, drives the flow for real. The
Setup screen's "Use demo dataset" uses a fixed demo `dataset_id` and demo data.

## Error handling & UX states

Every screen handles **loading** (shadcn `Skeleton`/spinner), **error**
(inline message + Retry, then the demo fallback so the flow never dead-ends),
and **empty** states. There is always something on screen — mirroring the
backend's "the demo must not break" rule. A malformed CSV upload surfaces the
backend's 400 message inline; a bad `location` surfaces the 422 inline.

## Testing (Vitest + React Testing Library, jsdom)

- `lib/csv.ts`: PO → CSV string is correct (headers, rows, totals, escaping).
- `lib/api.ts`: live path calls `fetch` with the right URL/body; falls back to
  demo fixtures on unset URL / demo toggle / thrown fetch.
- `lib/store.tsx`: threads and persists `dataset_id` and results across screens.
- Each screen: renders its data correctly; shows loading and error states;
  Next unlocks only after a successful call.
- `forecast-chart.tsx`: renders a series per item. `price-table.tsx`:
  highlights the cheapest supplier. `po-table.tsx`: computes the grand total.
- `stepper.tsx`: reflects current progress.

## Deployment (Vercel)

- Vercel project rooted at `frontend/`; framework preset **Next.js**.
- `NEXT_PUBLIC_API_URL` set in Vercel env → the AMD Cloud backend endpoint.
  Absent → demo mode, so the URL still works.
- Backend CORS is already open to the frontend (Plan 1).
- `frontend/README.md` documents local run, the env var, demo mode, and the
  Vercel deploy; links back to `docs/AMD_USAGE.md` for the AMD-compute proof.

## Deliverables produced by Plan 2

- A working `frontend/` Next.js app (4 screens) with passing Vitest/RTL tests.
- Demo-mode fixtures making the hosted URL self-sufficient.
- A Vercel deployment (hosted URL) + `frontend/README.md`.
- (Deck and demo video remain a separate, later session.)
