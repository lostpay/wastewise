import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse, ForecastAdjustedItem, POLine, Horizon } from "./types";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE, isDemoMode } from "./demo";

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

export function runSourcing(
  items: { item: string; qty: number }[],
  location: string,
  datasetId?: string | null,
): Promise<SourcingResponse> {
  return call("/sourcing", jsonInit({ items, location, dataset_id: datasetId ?? undefined }), DEMO_SOURCING);
}

export function runRationale(
  items: ForecastAdjustedItem[],
  lines: POLine[],
  savings: number,
  total: number,
): Promise<RationaleResponse> {
  return call("/rationale", jsonInit({ items, lines, savings, total }), DEMO_RATIONALE);
}
