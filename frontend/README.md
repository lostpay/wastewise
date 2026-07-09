# WasteWise Frontend

Next.js (App Router) UI for WasteWise — four stepwise screens
(Setup → Forecast & Adjustments → Sourcing → Purchase Order) wired to the
FastAPI backend, with a baked-in demo mode.

## Run locally
    npm install
    cp .env.example .env.local   # set NEXT_PUBLIC_API_URL to the backend; leave unset for demo mode
    npm run dev                  # http://localhost:3000

Tests: `npm test`

## Demo mode
If `NEXT_PUBLIC_API_URL` is unset (or you click "Use demo dataset"), the app
serves pre-captured responses so the full flow works with no backend. This is
why the hosted URL stays live even when the AMD Cloud backend is offline.
Two demo datasets exist on the backend: the small US-item one exercises the
full pipeline including sourcing; the larger one shows a real forecast-vs-baseline
improvement but should not be used for the sourcing step (non-US items).

## Backend
Runs the two LLM judgment steps on an AMD Radeon PRO W7900 via vLLM — see
`../docs/AMD_USAGE.md`. Point `NEXT_PUBLIC_API_URL` at that backend for a live run.

## Hosted
- Live app (Vercel production → Render backend): `<paste production URL>`
- AMD-backed preview (Vercel preview → W7900 vLLM tunnel): `<paste preview URL, when running>`

Wiring `NEXT_PUBLIC_API_URL` and verifying a real end-to-end run:
[`../docs/DEPLOY.md`](../docs/DEPLOY.md).
