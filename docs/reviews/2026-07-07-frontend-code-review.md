# Frontend Code Review — 2026-07-07

**Scope:** hand-authored code on the `frontend` branch (WasteWise Next.js wizard).
**Reviewed at:** HEAD `1cf90e0` (post whole-branch review + fixes).
**Lens:** code-reviewer skill — Security → Performance → Correctness → Maintainability.
**Fixes committed at:** `87ebbaa`.

## Context

The frontend is a client-only Next.js 16 App Router app: four wizard screens
(Setup → Forecast → Sourcing → Order), a React-Context store persisted to
`sessionStorage`, a typed API client with a demo-mode fallback, and a
client-side CSV export. No database, no auth, no server-rendered user input,
no `dangerouslySetInnerHTML` — so the classic SQL-injection and stored/reflected
XSS rules do not apply (React auto-escapes all JSX interpolation). The genuine
risk surface is the **CSV export** and the **sessionStorage hydration**.

## Findings

### 1. CSV export escaping was incomplete — FIXED (`lib/csv.ts`)

- **Was:** `esc()` was applied only to the `note` field; `item` and `supplier`
  were joined raw. Two problems:
  1. **Structural corruption (correctness):** against a live backend, an `item`
     or `supplier` containing a comma, quote, or newline shifts the row's
     columns and breaks the CSV.
  2. **CSV formula injection (security, low severity):** no field neutralized a
     leading `=`, `+`, `-`, or `@`, so a value like `=HYPERLINK(...)` or
     `@SUM(...)` executes when the file is opened in Excel/Google Sheets.
- **Fix:** every string field (`item`, `supplier`, `note`) now runs through
  `esc()`, and `esc()` prefixes an apostrophe to any value starting with
  `= + - @` before applying RFC-4180 quote/comma/newline escaping.
- **Tests added** (`__tests__/csv.test.ts`): item/supplier with commas & quotes
  are individually quoted; formula-triggering fields are apostrophe-prefixed.

### 2. Corrupt `sessionStorage` could wedge the app — FIXED (`lib/store.tsx`)

- **Was:** the hydration effect called `JSON.parse(raw)` with no guard. A
  malformed `ww_state` value threw, so `setHydrated(true)` never ran; because
  every page gates rendering on `hydrated`, the user got a permanently blank
  screen with no recovery path.
- **Subtlety found during the fix:** the parse was happening lazily *inside* the
  `setState` updater, so it threw during the reducer — a `try/catch` around the
  `setState` call did **not** catch it. The fix parses eagerly into a local
  before calling `setState`, so the `catch` actually fires.
- **Fix:** parse inside `try`; on failure, drop the corrupt key
  (`sessionStorage.removeItem`) and fall back to defaults; always
  `setHydrated(true)`.
- **Test added** (`__tests__/store.test.tsx`): a corrupt `ww_state` still
  hydrates to defaults and clears the bad value instead of throwing.

### Not changed (accepted / deferred)

- **No retry affordance** on the forecast/sourcing error state — after an error
  the `started` ref stays set, so recovery needs a manual reload. Acceptable for
  a scripted demo; a "Try again" button would improve a live failure. (Minor.)
- **Context value / `set` not memoized** (`lib/store.tsx`) — recreated each
  render, re-rendering all `useWizard()` consumers. Negligible at this scale;
  `useCallback`/`useMemo` is the idiomatic cleanup. (Minor.)
- Unused-`hydrated`-ref dead code was already removed in `1cf90e0` when the
  reactive `hydrated` flag was wired in.

## Verified strong

- **Demo-fallback contract** (`lib/api.ts`): fixture returned only on demo mode /
  fetch-throw / HTTP ≥ 500; `ApiError(status, detail)` thrown on 4xx; malformed
  error bodies guarded with `.json().catch(() => ({}))`. This is the
  load-bearing "hosted URL always completes the flow" behavior and it is correct.
- Full TypeScript typing end to end; no `any`; no hardcoded secrets
  (`NEXT_PUBLIC_API_URL` is a public build-time var by design).
- Error handling symmetric across all four screens; 31 tests cover happy,
  4xx-inline, connectivity-fallback, hydration-gate, CSV-escaping, and
  corrupt-storage paths.

## Result

- `npm test` → **31 passed** (10 files).
- `npm run build` → succeeds; routes `/`, `/setup`, `/forecast`, `/sourcing`,
  `/order` compiled (plus the benign Turbopack multi-lockfile warning).
