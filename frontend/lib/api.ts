import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse, ForecastAdjustedItem, POLine, Horizon, Currency } from "./types";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE, isDemoMode, markDemoServed } from "./demo";

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
  if (isDemoMode()) {
    markDemoServed();
    return demo;
  }
  let res: Response;
  try {
    res = await fetch(base() + path, init);
  } catch {
    markDemoServed();
    return demo; // connectivity failure -> demo fallback
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status >= 500) {
    markDemoServed();
    return demo; // server/upstream down -> demo fallback
  }
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, formatDetail(body) ?? `Request failed (${res.status})`);
}

// FastAPI returns a string `detail` for HTTPException and an array of
// {loc, msg, type, ...} for Pydantic validation errors. Rendering the array
// via a template string produces "[object Object]", so extract a readable
// message here.
function formatDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
      .filter(Boolean)
      .join("; ") || null;
  }
  return null;
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

export function runSourcing(
  items: { item: string; qty: number }[],
  location: string,
  datasetId?: string | null,
  currency: Currency = "USD",
): Promise<SourcingResponse> {
  return call(
    "/sourcing",
    jsonInit({ items, location, dataset_id: datasetId ?? undefined, currency }),
    DEMO_SOURCING,
  );
}

export function runRationale(
  items: ForecastAdjustedItem[],
  lines: POLine[],
  savings: number,
  total: number,
): Promise<RationaleResponse> {
  return call("/rationale", jsonInit({ items, lines, savings, total }), DEMO_RATIONALE);
}
