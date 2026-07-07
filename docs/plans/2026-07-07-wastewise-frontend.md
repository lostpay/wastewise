# WasteWise Frontend Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WasteWise web UI — a Next.js app of four stepwise screens (Setup → Forecast & Adjustments → Sourcing → Purchase Order) wired to the Plan 1 backend, with a baked-in demo-mode fallback, deployed to Vercel.

**Architecture:** A client-driven wizard. Four App Router routes each map to one backend endpoint; a React-Context store threads `dataset_id` and results between them (persisted to `sessionStorage`). A typed API client (`lib/api.ts`) calls the live backend at `NEXT_PUBLIC_API_URL` and transparently falls back to pre-captured demo fixtures on connectivity failure or when no backend is configured, so the hosted URL always completes the flow. Screen 4 is derived client-side from the sourcing result (no extra endpoint) and exports a CSV.

**Tech Stack:** Next.js (App Router) + TypeScript, Tailwind CSS, shadcn/ui, Recharts, Vitest + React Testing Library (jsdom). Deployed on Vercel.

## Global Constraints

- **Language of all UI copy and agent-surfaced text: English.** (Hackathon rule.)
- **The hosted Vercel URL must complete the full flow even when the backend is offline** — via the demo-mode fallback. When `NEXT_PUBLIC_API_URL` is unset, demo mode is ON by default.
- **No auth for the MVP.** A `dataset_id` threads the calls.
- **Backend contract is fixed** (below) — the frontend adapts to it.
- **`location` is `"lat,lon"`** (backend returns 422 otherwise); **`horizon`** is `"day"` or `"week"`.
- **Demo fallback is for connectivity failures only** (fetch throws or HTTP ≥ 500). A **4xx surfaces its message inline** (bad CSV → 400, bad location → 422) — it is NOT swallowed by the fallback.
- **Commit messages: plain Conventional Commits, no AI-attribution trailer.**
- **All commands run from the `frontend/` directory** unless stated otherwise. Windows; the repo already contains `backend/`. Git resolves the repo root automatically.
- **Node 18+.** Use `npm`.

## Backend API contract (consumed; built in Plan 1)

```
GET  /health   -> { "status": "ok" }
POST /upload   (multipart form field `file`: CSV)
               -> { dataset_id, summary: { dataset_id, n_rows, items[], start_date, end_date } }
POST /forecast { dataset_id, horizon: "day"|"week", location: "lat,lon" }
               -> { items: [{ item, forecast, adjusted_qty, reason }], baseline_delta }
POST /sourcing { items: [{ item, qty }], location: "lat,lon" }
               -> { lines: [{ item, qty, supplier, unit_price, line_total, note }], total, savings }
```

---

## File Structure

```
frontend/
  package.json, tsconfig.json, next.config.mjs, tailwind.config.ts,
  postcss.config.mjs, components.json, vitest.config.ts, vitest.setup.ts, .env.example
  app/
    globals.css
    layout.tsx            # shell: <WizardProvider> + <Stepper> + <main>
    page.tsx              # redirect -> /setup
    setup/page.tsx        # Screen 1  -> POST /upload
    forecast/page.tsx     # Screen 2  -> POST /forecast
    sourcing/page.tsx     # Screen 3  -> POST /sourcing
    order/page.tsx        # Screen 4  (derived from sourcing result)
  components/
    stepper.tsx
    forecast-chart.tsx
    price-table.tsx
    po-table.tsx
    reason-badge.tsx
    stat-tile.tsx
    ui/                   # shadcn/ui primitives (generated)
  lib/
    types.ts
    demo.ts               # fixtures + isDemoMode()/setDemoMode()
    api.ts                # typed client + fallback
    store.tsx             # WizardProvider + useWizard()
    csv.ts                # poToCsv() (pure)
    utils.ts              # cn() (from shadcn init)
  __tests__/
    test-utils.tsx        # renderWithWizard()
    demo.test.ts
    api.test.ts
    store.test.tsx
    stepper.test.tsx
    setup.test.tsx
    forecast.test.tsx
    sourcing.test.tsx
    order.test.tsx
    csv.test.ts
  README.md
```

---

### Task 0: Scaffold Next.js app + tooling

**Files:**
- Create the whole `frontend/` app via `create-next-app`, then add shadcn/ui, Recharts, and Vitest/RTL.
- Create: `frontend/vitest.config.ts`, `frontend/vitest.setup.ts`, `frontend/.env.example`, `frontend/__tests__/smoke.test.ts`
- Modify: `frontend/package.json` (add `test` script)

**Interfaces:**
- Produces: a buildable Next.js app with `npm test` (Vitest) and `npm run build` working; the `@/*` import alias; Tailwind + shadcn/ui configured.

- [ ] **Step 1: Scaffold the Next.js app**

From the **repo root** (`supply and demand/`), run (all flags supplied so it is non-interactive):

```bash
npx --yes create-next-app@latest frontend --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Expected: a `frontend/` directory with `app/`, `package.json`, `tailwind.config.ts`, `tsconfig.json`. If the CLI still prompts, accept the defaults matching those flags.

- [ ] **Step 2: Install runtime + test dependencies**

From `frontend/`:

```bash
npm install recharts
npm install -D vitest @vitejs/plugin-react jsdom vite-tsconfig-paths @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Initialize shadcn/ui and add primitives**

From `frontend/`:

```bash
npx --yes shadcn@latest init -d
npx --yes shadcn@latest add button card table badge input select switch skeleton label -y
```

Expected: `components.json`, `lib/utils.ts` (with `cn`), and `components/ui/*.tsx` exist.

- [ ] **Step 4: Configure Vitest**

Create `frontend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

Create `frontend/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Add the `test` script**

In `frontend/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 6: Create `.env.example`**

Create `frontend/.env.example`:

```
# Point at the FastAPI backend (AMD Cloud / local). If unset, the app runs in demo mode.
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 7: Write a smoke test**

Create `frontend/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("tooling", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Verify test + build**

Run: `npm test`
Expected: 1 passed.

Run: `npm run build`
Expected: Next.js build succeeds (the default starter page compiles).

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "chore: scaffold next.js frontend with tailwind, shadcn/ui, vitest"
```

---

### Task 1: Domain types + demo fixtures

**Files:**
- Create: `frontend/lib/types.ts`, `frontend/lib/demo.ts`
- Test: `frontend/__tests__/demo.test.ts`

**Interfaces:**
- Produces:
  - `lib/types.ts`: `DatasetSummary`, `UploadResponse`, `ForecastAdjustedItem`, `ForecastResponse`, `POLine`, `SourcingResponse`, `Horizon`.
  - `lib/demo.ts`: `DEMO_UPLOAD: UploadResponse`, `DEMO_FORECAST: ForecastResponse`, `DEMO_SOURCING: SourcingResponse`, `isDemoMode(): boolean`, `setDemoMode(on: boolean): void`.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/demo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, isDemoMode, setDemoMode } from "@/lib/demo";

describe("demo fixtures", () => {
  it("upload fixture has a dataset id and summary items", () => {
    expect(DEMO_UPLOAD.dataset_id).toBeTruthy();
    expect(DEMO_UPLOAD.summary.items.length).toBeGreaterThan(0);
  });

  it("forecast fixture items each have item, adjusted_qty, reason", () => {
    expect(DEMO_FORECAST.items.length).toBeGreaterThan(0);
    for (const it of DEMO_FORECAST.items) {
      expect(it.item).toBeTruthy();
      expect(typeof it.adjusted_qty).toBe("number");
      expect(it.reason).toBeTruthy();
    }
  });

  it("sourcing fixture lines have supplier and totals", () => {
    expect(DEMO_SOURCING.lines.length).toBeGreaterThan(0);
    expect(DEMO_SOURCING.total).toBeGreaterThan(0);
  });
});

describe("demo mode toggle", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is on when the demo flag is set", () => {
    setDemoMode(true);
    expect(isDemoMode()).toBe(true);
    setDemoMode(false);
    // With NEXT_PUBLIC_API_URL unset in the test env, demo stays on by default.
    expect(isDemoMode()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- demo`
Expected: FAIL — cannot resolve `@/lib/demo`.

- [ ] **Step 3: Write `lib/types.ts`**

```ts
export type Horizon = "day" | "week";

export interface DatasetSummary {
  dataset_id: string;
  n_rows: number;
  items: string[];
  start_date: string;
  end_date: string;
}

export interface UploadResponse {
  dataset_id: string;
  summary: DatasetSummary;
}

export interface ForecastAdjustedItem {
  item: string;
  forecast: number;
  adjusted_qty: number;
  reason: string;
}

export interface ForecastResponse {
  items: ForecastAdjustedItem[];
  baseline_delta: number;
}

export interface POLine {
  item: string;
  qty: number;
  supplier: string;
  unit_price: number;
  line_total: number;
  note: string;
}

export interface SourcingResponse {
  lines: POLine[];
  total: number;
  savings: number;
}
```

- [ ] **Step 4: Write `lib/demo.ts`**

```ts
import type { UploadResponse, ForecastResponse, SourcingResponse } from "./types";

export const DEMO_UPLOAD: UploadResponse = {
  dataset_id: "demo",
  summary: {
    dataset_id: "demo",
    n_rows: 270,
    items: ["cabbage", "chicken", "pork"],
    start_date: "2026-04-01",
    end_date: "2026-06-29",
  },
};

export const DEMO_FORECAST: ForecastResponse = {
  baseline_delta: 0.18,
  items: [
    { item: "cabbage", forecast: 168.0, adjusted_qty: 150.0, reason: "Rain forecast lowers dine-in demand." },
    { item: "pork", forecast: 126.0, adjusted_qty: 118.0, reason: "Rain forecast lowers dine-in demand." },
    { item: "chicken", forecast: 210.0, adjusted_qty: 196.0, reason: "Rain forecast lowers dine-in demand." },
  ],
};

export const DEMO_SOURCING: SourcingResponse = {
  total: 618.4,
  savings: 92.0,
  lines: [
    { item: "cabbage", qty: 150, supplier: "Kroger", unit_price: 1.4, line_total: 210.0, note: "30% under market benchmark." },
    { item: "pork", qty: 118, supplier: "Kroger", unit_price: 1.4, line_total: 165.2, note: "30% under market benchmark." },
    { item: "chicken", qty: 196, supplier: "Kroger", unit_price: 1.24, line_total: 243.2, note: "38% under market benchmark." },
  ],
};

const DEMO_KEY = "ww_demo";

export function setDemoMode(on: boolean): void {
  if (typeof window === "undefined") return;
  if (on) window.sessionStorage.setItem(DEMO_KEY, "1");
  else window.sessionStorage.removeItem(DEMO_KEY);
}

export function isDemoMode(): boolean {
  const forced = typeof window !== "undefined" && window.sessionStorage.getItem(DEMO_KEY) === "1";
  const noBackend = !process.env.NEXT_PUBLIC_API_URL;
  return forced || noBackend;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- demo`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/demo.ts frontend/__tests__/demo.test.ts
git commit -m "feat: add frontend domain types and demo fixtures"
```

---

### Task 2: API client with demo fallback

**Files:**
- Create: `frontend/lib/api.ts`
- Test: `frontend/__tests__/api.test.ts`

**Interfaces:**
- Consumes: `lib/types.ts`, `lib/demo.ts` (Task 1).
- Produces:
  - `class ApiError extends Error { status: number }`
  - `uploadCsv(file: File): Promise<UploadResponse>`
  - `runForecast(datasetId: string, horizon: Horizon, location: string): Promise<ForecastResponse>`
  - `runSourcing(items: { item: string; qty: number }[], location: string): Promise<SourcingResponse>`
- Behavior: demo mode → return the matching fixture without fetching. Live: `fetch` throws or HTTP ≥ 500 → return the fixture (fallback). HTTP 4xx → throw `ApiError(status, detail)`. OK → parsed JSON.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/api.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadCsv, runForecast, ApiError } from "@/lib/api";
import { DEMO_FORECAST } from "@/lib/demo";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on a 200", async () => {
    const body = { items: [{ item: "cabbage", forecast: 10, adjusted_qty: 9, reason: "x" }], baseline_delta: 0.1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    const res = await runForecast("ds1", "week", "40.7,-74.0");
    expect(res.items[0].item).toBe("cabbage");
  });

  it("falls back to the demo fixture when fetch throws (backend offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await runForecast("ds1", "week", "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
  });

  it("falls back to the demo fixture on HTTP 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const res = await runForecast("ds1", "week", "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
  });

  it("throws ApiError with the detail on a 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "bad csv" }, 400)));
    const file = new File(["x"], "s.csv", { type: "text/csv" });
    await expect(uploadCsv(file)).rejects.toMatchObject({ status: 400, message: "bad csv" } as ApiError);
  });

  it("returns the fixture in demo mode without fetching", async () => {
    window.sessionStorage.setItem("ww_demo", "1");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await runForecast("ds1", "week", "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- api`
Expected: FAIL — cannot resolve `@/lib/api`.

- [ ] **Step 3: Write `lib/api.ts`**

```ts
import type { UploadResponse, ForecastResponse, SourcingResponse, Horizon } from "./types";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, isDemoMode } from "./demo";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function base(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "";
}

async function call<T>(path: string, init: RequestInit, demo: T): Promise<T> {
  if (isDemoMode()) return demo;
  let res: Response;
  try {
    res = await fetch(base() + path, init);
  } catch {
    return demo; // connectivity failure -> demo fallback
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status >= 500) return demo; // server/upstream down -> demo fallback
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, (body as { detail?: string }).detail ?? `Request failed (${res.status})`);
}

function jsonInit(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function uploadCsv(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  return call("/upload", { method: "POST", body: form }, DEMO_UPLOAD);
}

export function runForecast(datasetId: string, horizon: Horizon, location: string): Promise<ForecastResponse> {
  return call("/forecast", jsonInit({ dataset_id: datasetId, horizon, location }), DEMO_FORECAST);
}

export function runSourcing(items: { item: string; qty: number }[], location: string): Promise<SourcingResponse> {
  return call("/sourcing", jsonInit({ items, location }), DEMO_SOURCING);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- api`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api.ts frontend/__tests__/api.test.ts
git commit -m "feat: add API client with demo-mode fallback"
```

---

### Task 3: Wizard store + test helper

**Files:**
- Create: `frontend/lib/store.tsx`, `frontend/__tests__/test-utils.tsx`
- Test: `frontend/__tests__/store.test.tsx`

**Interfaces:**
- Consumes: `lib/types.ts` (Task 1).
- Produces:
  - `WizardProvider` (React component) wrapping children.
  - `useWizard()` returning `{ location, horizon, datasetId, summary, forecast, sourcing, set }` where `set(partial)` merges and persists state to `sessionStorage` under key `ww_state`.
  - Default `location = "40.7,-74.0"`, `horizon = "week"`.
  - `__tests__/test-utils.tsx`: `renderWithWizard(ui, { initial? })` — renders `ui` inside `WizardProvider`, optionally seeding `sessionStorage` state first; re-exports RTL.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/store.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { WizardProvider, useWizard } from "@/lib/store";

const wrapper = ({ children }: { children: React.ReactNode }) => <WizardProvider>{children}</WizardProvider>;

describe("wizard store", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("exposes sensible defaults", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.location).toBe("40.7,-74.0");
    expect(result.current.horizon).toBe("week");
    expect(result.current.datasetId).toBeNull();
  });

  it("merges and persists updates to sessionStorage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    act(() => result.current.set({ datasetId: "abc123" }));
    expect(result.current.datasetId).toBe("abc123");
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("abc123");
  });

  it("rehydrates persisted state on mount", () => {
    window.sessionStorage.setItem("ww_state", JSON.stringify({ datasetId: "seed", horizon: "day" }));
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.datasetId).toBe("seed");
    expect(result.current.horizon).toBe("day");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- store`
Expected: FAIL — cannot resolve `@/lib/store`.

- [ ] **Step 3: Write `lib/store.tsx`**

```tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DatasetSummary, ForecastResponse, SourcingResponse, Horizon } from "./types";

const KEY = "ww_state";

interface WizardState {
  location: string;
  horizon: Horizon;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
};

interface WizardContextValue extends WizardState {
  set: (partial: Partial<WizardState>) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(DEFAULTS);
  const hydrated = useRef(false);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
    if (raw) setState((s) => ({ ...s, ...JSON.parse(raw) }));
    hydrated.current = true;
  }, []);

  const set = (partial: Partial<WizardState>) =>
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") window.sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

  return <WizardContext.Provider value={{ ...state, set }}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
```

- [ ] **Step 4: Write the shared test helper**

Create `frontend/__tests__/test-utils.tsx`:

```tsx
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { WizardProvider } from "@/lib/store";

export function renderWithWizard(ui: ReactElement, opts?: { initial?: Record<string, unknown> }) {
  if (opts?.initial) window.sessionStorage.setItem("ww_state", JSON.stringify(opts.initial));
  return render(<WizardProvider>{ui}</WizardProvider>);
}

export * from "@testing-library/react";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- store`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/store.tsx frontend/__tests__/store.test.tsx frontend/__tests__/test-utils.tsx
git commit -m "feat: add wizard state store and test helper"
```

---

### Task 4: Stepper, root layout, and redirect

**Files:**
- Create: `frontend/components/stepper.tsx`
- Modify: `frontend/app/layout.tsx`, `frontend/app/page.tsx`
- Test: `frontend/__tests__/stepper.test.tsx`

**Interfaces:**
- Consumes: `WizardProvider` (Task 3).
- Produces: `Stepper({ current }: { current: number })` rendering the 4 step labels (`Setup`, `Forecast`, `Sourcing`, `Order`) and marking `current` (0-based) active via `aria-current="step"`. `app/layout.tsx` wraps everything in `WizardProvider`. `app/page.tsx` redirects to `/setup`.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/stepper.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "@/components/stepper";

describe("Stepper", () => {
  it("renders the four step labels", () => {
    render(<Stepper current={0} />);
    for (const label of ["Setup", "Forecast", "Sourcing", "Order"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the current step with aria-current", () => {
    render(<Stepper current={2} />);
    expect(screen.getByText("Sourcing").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stepper`
Expected: FAIL — cannot resolve `@/components/stepper`.

- [ ] **Step 3: Write `components/stepper.tsx`**

```tsx
const STEPS = ["Setup", "Forecast", "Sourcing", "Order"];

export function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Progress" className="flex items-center gap-2 border-b px-6 py-4">
      {STEPS.map((label, i) => (
        <div
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={`flex items-center gap-2 text-sm ${i === current ? "font-semibold text-foreground" : "text-muted-foreground"}`}
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${i <= current ? "border-foreground" : "border-muted"}`}>
            {i + 1}
          </span>
          <span>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-2 text-muted-foreground">→</span>}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Rewrite `app/layout.tsx`**

Keep the generated font/metadata setup and wrap the body content in the provider:

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { WizardProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "WasteWise",
  description: "Restaurant demand forecasting and supplier sourcing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WizardProvider>
          <header className="border-b px-6 py-4">
            <h1 className="text-lg font-bold">WasteWise</h1>
          </header>
          {children}
        </WizardProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Rewrite `app/page.tsx` to redirect**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/setup");
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- stepper`
Expected: PASS (2 passed).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/stepper.tsx frontend/app/layout.tsx frontend/app/page.tsx frontend/__tests__/stepper.test.tsx
git commit -m "feat: add stepper, provider layout, and root redirect"
```

---

### Task 5: Screen 1 — Setup

**Files:**
- Create: `frontend/app/setup/page.tsx`
- Test: `frontend/__tests__/setup.test.tsx`

**Interfaces:**
- Consumes: `useWizard` (Task 3), `uploadCsv`, `ApiError` (Task 2), `setDemoMode` (Task 1), `Stepper` (Task 4).
- Produces: a client page that lets the user (a) pick a file and upload, or (b) click **Use demo dataset**; set `location` and `horizon`; on success stores `datasetId`/`summary` and routes to `/forecast`. On `ApiError`, shows the message inline.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/setup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SetupPage from "@/app/setup/page";
import * as api from "@/lib/api";

describe("Setup screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("uses the demo dataset and advances to forecast", async () => {
    renderWithWizard(<SetupPage />);
    await userEvent.click(screen.getByRole("button", { name: /use demo dataset/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/forecast"));
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("demo");
  });

  it("shows the backend error message on a 400 upload", async () => {
    vi.spyOn(api, "uploadCsv").mockRejectedValue(new api.ApiError(400, "CSV must contain columns"));
    renderWithWizard(<SetupPage />);
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/sales csv/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^upload$/i }));
    expect(await screen.findByText(/CSV must contain columns/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- setup`
Expected: FAIL — cannot resolve `@/app/setup/page`.

- [ ] **Step 3: Write `app/setup/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { uploadCsv, ApiError } from "@/lib/api";
import { setDemoMode } from "@/lib/demo";
import type { Horizon, UploadResponse } from "@/lib/types";
import { Stepper } from "@/components/stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupPage() {
  const router = useRouter();
  const { location, horizon, set } = useWizard();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function advance(res: UploadResponse) {
    set({ datasetId: res.dataset_id, summary: res.summary });
    router.push("/forecast");
  }

  async function onUpload() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      advance(await uploadCsv(file));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onDemo() {
    setDemoMode(true);
    setError(null);
    setLoading(true);
    try {
      advance(await uploadCsv(new File([""], "demo.csv", { type: "text/csv" })));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Stepper current={0} />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Set up your forecast</h2>

        <div className="space-y-2">
          <Label htmlFor="csv">Sales CSV</Label>
          <Input id="csv" type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="loc">Location (lat,lon)</Label>
            <Input id="loc" value={location} onChange={(e) => set({ location: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="horizon">Horizon</Label>
            <select
              id="horizon"
              className="h-9 w-full rounded-md border px-3 text-sm"
              value={horizon}
              onChange={(e) => set({ horizon: e.target.value as Horizon })}
            >
              <option value="day">Next day</option>
              <option value="week">Next week</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button onClick={onUpload} disabled={!file || loading}>Upload</Button>
          <Button variant="secondary" onClick={onDemo} disabled={loading}>Use demo dataset</Button>
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- setup`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/setup/page.tsx frontend/__tests__/setup.test.tsx
git commit -m "feat: add setup screen with upload and demo dataset"
```

---

### Task 6: Screen 2 — Forecast & Adjustments

**Files:**
- Create: `frontend/app/forecast/page.tsx`, `frontend/components/forecast-chart.tsx`, `frontend/components/stat-tile.tsx`, `frontend/components/reason-badge.tsx`
- Test: `frontend/__tests__/forecast.test.tsx`

**Interfaces:**
- Consumes: `useWizard` (Task 3), `runForecast` (Task 2), `Stepper` (Task 4), `ForecastResponse`/`ForecastAdjustedItem` (Task 1).
- Produces:
  - `StatTile({ label, value }: { label: string; value: string })`.
  - `ReasonBadge({ reason }: { reason: string })`.
  - `ForecastChart({ items }: { items: ForecastAdjustedItem[] })` — a Recharts bar chart with a `forecast` and an `adjusted_qty` bar per item.
  - `app/forecast/page.tsx`: on mount, if `datasetId` is missing redirects to `/setup`; otherwise calls `runForecast(datasetId, horizon, location)`, stores the result, and renders the chart, the baseline-delta stat tile, and a per-item forecast → adjusted list with reason badges. A **Next: Sourcing** button routes to `/sourcing`.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/forecast.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// Recharts needs a sized container; stub ResponsiveContainer to render children.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 800, height: 400 }}>{children}</div> };
});

import ForecastPage from "@/app/forecast/page";
import * as api from "@/lib/api";
import { DEMO_FORECAST } from "@/lib/demo";

describe("Forecast screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("redirects to setup when no dataset is loaded", () => {
    renderWithWizard(<ForecastPage />);
    expect(push).toHaveBeenCalledWith("/setup");
  });

  it("renders adjusted items and reasons after forecasting", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("cabbage")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Rain forecast lowers dine-in demand/i)).toBeInTheDocument());
    expect(screen.getByText(/18%/)).toBeInTheDocument(); // baseline_delta 0.18 -> "18%"
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- forecast`
Expected: FAIL — cannot resolve the new modules.

- [ ] **Step 3: Write `components/stat-tile.tsx`**

```tsx
import { Card, CardContent } from "@/components/ui/card";

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Write `components/reason-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";

export function ReasonBadge({ reason }: { reason: string }) {
  return <Badge variant="secondary" className="whitespace-normal text-left">{reason}</Badge>;
}
```

- [ ] **Step 5: Write `components/forecast-chart.tsx`**

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem } from "@/lib/types";

export function ForecastChart({ items }: { items: ForecastAdjustedItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={items}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="item" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="forecast" fill="#94a3b8" name="Forecast" />
        <Bar dataKey="adjusted_qty" fill="#0f172a" name="Adjusted" />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Write `app/forecast/page.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runForecast } from "@/lib/api";
import { Stepper } from "@/components/stepper";
import { ForecastChart } from "@/components/forecast-chart";
import { StatTile } from "@/components/stat-tile";
import { ReasonBadge } from "@/components/reason-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function ForecastPage() {
  const router = useRouter();
  const { datasetId, horizon, location, forecast, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!datasetId) {
      router.push("/setup");
      return;
    }
    if (forecast || started.current) return;
    started.current = true;
    setLoading(true);
    runForecast(datasetId, horizon, location)
      .then((res) => set({ forecast: res }))
      .finally(() => setLoading(false));
  }, [datasetId, horizon, location, forecast, router, set]);

  if (!datasetId) return null;

  return (
    <>
      <Stepper current={1} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Forecast &amp; adjustments</h2>
        {loading || !forecast ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <>
            <StatTile label="Model improvement over baseline" value={`${Math.round(forecast.baseline_delta * 100)}%`} />
            <ForecastChart items={forecast.items} />
            <ul className="space-y-3">
              {forecast.items.map((it) => (
                <li key={it.item} className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <span className="font-medium capitalize">{it.item}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {it.forecast} → <span className="font-semibold text-foreground">{it.adjusted_qty}</span>
                    </span>
                  </div>
                  <ReasonBadge reason={it.reason} />
                </li>
              ))}
            </ul>
            <Button onClick={() => router.push("/sourcing")}>Next: Sourcing</Button>
          </>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- forecast`
Expected: PASS (2 passed).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/forecast/page.tsx frontend/components/forecast-chart.tsx frontend/components/stat-tile.tsx frontend/components/reason-badge.tsx frontend/__tests__/forecast.test.tsx
git commit -m "feat: add forecast screen with chart, stat tile, and reason badges"
```

---

### Task 7: Screen 3 — Sourcing

**Files:**
- Create: `frontend/app/sourcing/page.tsx`, `frontend/components/price-table.tsx`
- Test: `frontend/__tests__/sourcing.test.tsx`

**Interfaces:**
- Consumes: `useWizard` (Task 3), `runSourcing` (Task 2), `Stepper` (Task 4), `StatTile` (Task 6), `SourcingResponse`/`POLine` (Task 1).
- Produces:
  - `PriceTable({ lines }: { lines: POLine[] })` — a shadcn `Table` with columns item / supplier / unit price / note; each row shows the chosen supplier.
  - `app/sourcing/page.tsx`: on mount, redirect to `/forecast` if `forecast` is missing; else call `runSourcing(items, location)` where `items` maps each forecast item to `{ item, qty: adjusted_qty }`; store the result; render the price table and a **savings** stat tile. A **Next: Purchase Order** button routes to `/order`.

- [ ] **Step 1: Write the failing test**

Create `frontend/__tests__/sourcing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SourcingPage from "@/app/sourcing/page";
import * as api from "@/lib/api";
import { DEMO_FORECAST, DEMO_SOURCING } from "@/lib/demo";

describe("Sourcing screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("redirects to forecast when no forecast is present", () => {
    renderWithWizard(<SourcingPage />);
    expect(push).toHaveBeenCalledWith("/forecast");
  });

  it("sources using adjusted quantities and shows savings", async () => {
    const spy = vi.spyOn(api, "runSourcing").mockResolvedValue(DEMO_SOURCING);
    renderWithWizard(<SourcingPage />, { initial: { datasetId: "demo", forecast: DEMO_FORECAST } });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // called with {item, qty: adjusted_qty} pairs
    expect(spy.mock.calls[0][0]).toEqual([
      { item: "cabbage", qty: 150 },
      { item: "pork", qty: 118 },
      { item: "chicken", qty: 196 },
    ]);
    expect(await screen.findByText("Kroger")).toBeInTheDocument();
    expect(screen.getByText(/\$92/)).toBeInTheDocument(); // savings
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sourcing`
Expected: FAIL — cannot resolve the new modules.

- [ ] **Step 3: Write `components/price-table.tsx`**

```tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { POLine } from "@/lib/types";

export function PriceTable({ lines }: { lines: POLine[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.item}>
            <TableCell className="font-medium capitalize">{l.item}</TableCell>
            <TableCell>{l.supplier}</TableCell>
            <TableCell className="text-right">${l.unit_price.toFixed(2)}</TableCell>
            <TableCell className="text-muted-foreground">{l.note}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Write `app/sourcing/page.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runSourcing } from "@/lib/api";
import { Stepper } from "@/components/stepper";
import { PriceTable } from "@/components/price-table";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function SourcingPage() {
  const router = useRouter();
  const { forecast, location, sourcing, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!forecast) {
      router.push("/forecast");
      return;
    }
    if (sourcing || started.current) return;
    started.current = true;
    setLoading(true);
    const items = forecast.items.map((it) => ({ item: it.item, qty: it.adjusted_qty }));
    runSourcing(items, location)
      .then((res) => set({ sourcing: res }))
      .finally(() => setLoading(false));
  }, [forecast, location, sourcing, router, set]);

  if (!forecast) return null;

  return (
    <>
      <Stepper current={2} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Sourcing</h2>
        {loading || !sourcing ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <StatTile label="Estimated savings vs. market" value={`$${sourcing.savings.toFixed(2)}`} />
            <PriceTable lines={sourcing.lines} />
            <Button onClick={() => router.push("/order")}>Next: Purchase Order</Button>
          </>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- sourcing`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/sourcing/page.tsx frontend/components/price-table.tsx frontend/__tests__/sourcing.test.tsx
git commit -m "feat: add sourcing screen with price table and savings"
```

---

### Task 8: Screen 4 — Purchase Order + CSV export

**Files:**
- Create: `frontend/app/order/page.tsx`, `frontend/components/po-table.tsx`, `frontend/lib/csv.ts`
- Test: `frontend/__tests__/order.test.tsx`, `frontend/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: `useWizard` (Task 3), `Stepper` (Task 4), `SourcingResponse`/`POLine` (Task 1).
- Produces:
  - `poToCsv(lines: POLine[], total: number): string` (pure) — header `item,qty,supplier,unit_price,line_total,note`, one row per line (note quoted/escaped), then a final `Total,,,,<total>,` row.
  - `POTable({ lines, total }: { lines: POLine[]; total: number })` — the PO with a grand-total row.
  - `app/order/page.tsx`: redirect to `/sourcing` if `sourcing` is missing; else render the PO table with an **Approve** state and a **Download CSV** button that builds a blob from `poToCsv`.

- [ ] **Step 1: Write the failing csv test**

Create `frontend/__tests__/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { poToCsv } from "@/lib/csv";

describe("poToCsv", () => {
  it("emits a header, one row per line, and a total row", () => {
    const csv = poToCsv(
      [{ item: "cabbage", qty: 10, supplier: "Kroger", unit_price: 1.5, line_total: 15, note: "cheap, fresh" }],
      15,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("item,qty,supplier,unit_price,line_total,note");
    expect(lines[1]).toBe('cabbage,10,Kroger,1.5,15,"cheap, fresh"'); // note with comma is quoted
    expect(lines[2]).toBe("Total,,,,15,");
  });
});
```

- [ ] **Step 2: Write the failing order-screen test**

Create `frontend/__tests__/order.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import OrderPage from "@/app/order/page";
import { DEMO_SOURCING } from "@/lib/demo";

describe("Order screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("redirects to sourcing when no sourcing result is present", () => {
    renderWithWizard(<OrderPage />);
    expect(push).toHaveBeenCalledWith("/sourcing");
  });

  it("renders the PO with a grand total and an approve action", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    expect(screen.getByText("cabbage")).toBeInTheDocument();
    expect(screen.getByText(/\$618\.40/)).toBeInTheDocument(); // grand total
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- csv order`
Expected: FAIL — cannot resolve the new modules.

- [ ] **Step 4: Write `lib/csv.ts`**

```ts
import type { POLine } from "./types";

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function poToCsv(lines: POLine[], total: number): string {
  const header = "item,qty,supplier,unit_price,line_total,note";
  const rows = lines.map((l) =>
    [l.item, l.qty, l.supplier, l.unit_price, l.line_total, esc(l.note)].join(","),
  );
  return [header, ...rows, `Total,,,,${total},`].join("\n");
}
```

- [ ] **Step 5: Write `components/po-table.tsx`**

```tsx
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { POLine } from "@/lib/types";

export function POTable({ lines, total }: { lines: POLine[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead className="text-right">Line total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.item}>
            <TableCell className="font-medium capitalize">{l.item}</TableCell>
            <TableCell className="text-right">{l.qty}</TableCell>
            <TableCell>{l.supplier}</TableCell>
            <TableCell className="text-right">${l.unit_price.toFixed(2)}</TableCell>
            <TableCell className="text-right">${l.line_total.toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4}>Grand total</TableCell>
          <TableCell className="text-right font-bold">${total.toFixed(2)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
```

- [ ] **Step 6: Write `app/order/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { Stepper } from "@/components/stepper";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";

export default function OrderPage() {
  const router = useRouter();
  const { sourcing } = useWizard();
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!sourcing) router.push("/sourcing");
  }, [sourcing, router]);

  if (!sourcing) return null;

  function download() {
    if (!sourcing) return;
    const blob = new Blob([poToCsv(sourcing.lines, sourcing.total)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-order.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Stepper current={3} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Purchase order</h2>
        <POTable lines={sourcing.lines} total={sourcing.total} />
        <div className="flex items-center gap-3">
          <Button onClick={() => setApproved(true)} disabled={approved}>
            {approved ? "Approved ✓" : "Approve"}
          </Button>
          <Button variant="secondary" onClick={download}>Download CSV</Button>
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- csv order`
Expected: PASS (csv: 1, order: 2).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/order/page.tsx frontend/components/po-table.tsx frontend/lib/csv.ts frontend/__tests__/order.test.tsx frontend/__tests__/csv.test.ts
git commit -m "feat: add purchase order screen with CSV export"
```

---

### Task 9: Polish, full-suite green, and README

**Files:**
- Modify: `frontend/app/globals.css` (base page background/spacing only if needed), `frontend/app/setup/page.tsx` (demo-mode hint)
- Create: `frontend/README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass (Tasks 0–8).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build succeeds with all four routes (`/setup`, `/forecast`, `/sourcing`, `/order`) compiled.

- [ ] **Step 3: Add a demo-mode hint to Setup**

In `frontend/app/setup/page.tsx`, add this line just under the `<h2>` heading so users know the hosted URL is self-sufficient:

```tsx
<p className="text-sm text-muted-foreground">
  No backend configured? Click <span className="font-medium">Use demo dataset</span> to walk the full flow with sample data.
</p>
```

- [ ] **Step 4: Write `frontend/README.md`**

```markdown
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

## Backend
Runs the two LLM judgment steps on an AMD Radeon PRO W7900 via vLLM — see
`../docs/AMD_USAGE.md`. Point `NEXT_PUBLIC_API_URL` at that backend for a live run.
```

- [ ] **Step 5: Verify suite still green**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/setup/page.tsx frontend/README.md frontend/app/globals.css
git commit -m "docs: add frontend readme and demo-mode hint"
```

---

### Task 10: Vercel deployment

**Files:**
- Create: `frontend/vercel.json` (optional pin), `.gitignore` update if needed.

**Interfaces:**
- Consumes: the built app. This task has no unit tests — its deliverable is a working hosted URL. Verify by visiting it.

> **Note:** deploying requires the user's Vercel account (interactive `vercel login`). If running as a subagent without Vercel auth, STOP after Step 1 and report BLOCKED with the remaining steps for the user to run.

- [ ] **Step 1: Ensure the frontend ignores local env/build artifacts**

Confirm `frontend/.gitignore` (created by create-next-app) includes `.env*.local`, `.next/`, `node_modules/`. If missing, add them.

- [ ] **Step 2: Create `frontend/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

- [ ] **Step 3: Link and configure the project (user runs these)**

From `frontend/`:

```bash
npx vercel link           # choose/create the project; set root directory to the current dir
npx vercel env add NEXT_PUBLIC_API_URL production   # paste the AMD Cloud backend URL (or skip to stay in demo mode)
```

- [ ] **Step 4: Deploy**

```bash
npx vercel --prod
```

Expected: a production URL is printed. Visit it and walk Setup → Forecast → Sourcing → Order (demo mode if no backend env var). The flow completes end to end.

- [ ] **Step 5: Record the hosted URL**

Append the deployed URL to `frontend/README.md` under a `## Hosted` heading, then commit:

```bash
git add frontend/README.md frontend/vercel.json
git commit -m "chore: add vercel config and hosted url"
```

---

## Self-Review

**Spec coverage:**
- 4 stepwise screens, one endpoint each → Tasks 5–8 ✓
- Next.js + Tailwind + shadcn/ui + Recharts → Task 0 ✓
- Typed API client reading `NEXT_PUBLIC_API_URL` → Task 2 ✓
- Demo-mode fallback (unset URL / toggle / connectivity failure) with 4xx surfaced inline → Tasks 1, 2, 5 ✓
- Wizard state threading `dataset_id`, persisted to sessionStorage → Task 3 ✓
- Forecast chart + baseline-delta stat + reason badges → Task 6 ✓
- Sourcing price table + savings + adjusted-qty mapping → Task 7 ✓
- Purchase Order derived client-side + Approve + CSV export → Task 8 ✓
- Loading/error/empty states, English copy → Tasks 5–9 ✓
- Vitest + RTL tests → every task ✓
- Vercel deploy + README → Tasks 9–10 ✓
- Out of scope (deck, video) → correctly omitted ✓

**Placeholder scan:** none — every step has runnable code/commands. Task 10 Steps 3–4 are user-run infra commands (noted), not code placeholders.

**Type consistency:** `UploadResponse`/`ForecastResponse`/`SourcingResponse`/`POLine`/`ForecastAdjustedItem`/`Horizon` (Task 1) are used consistently by `api.ts` (Task 2), the store (Task 3), and every screen (Tasks 5–8). `useWizard().set(partial)` and the state keys (`datasetId`, `summary`, `forecast`, `sourcing`, `location`, `horizon`) match across Tasks 3, 5, 6, 7, 8. `runForecast(datasetId, horizon, location)` and `runSourcing(items, location)` signatures match their call sites. Demo fixture values (adjusted_qty 150/118/196, savings 92, total 618.40) are asserted verbatim in the Task 6/7/8 tests.

---

## Notes for the implementer

- **Recharts in jsdom:** charts need a sized container. The Task 6 test stubs `ResponsiveContainer`; reuse that pattern for any later chart test. Do not assert on SVG internals — assert on the data-driven text around the chart.
- **`next/navigation` in tests:** always `vi.mock("next/navigation", ...)` before importing the page, as shown; App Router hooks throw outside a router otherwise.
- **shadcn/ui components** are generated into `components/ui/` and committed — treat them as vendored; do not hand-edit unless a task says so.
- **Demo fixtures are the contract for the hosted URL.** If you capture real backend responses to replace them, keep the same shape and keep the Task 6–8 test assertions in sync.
- **`process.env.NEXT_PUBLIC_API_URL`** is inlined at build time by Next. In tests, control it with `vi.stubEnv`; in Vercel, set it in project env.
