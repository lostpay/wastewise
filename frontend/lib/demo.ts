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
    { item: "cabbage", qty: 150, supplier: "Kroger", unit_price: 1.4, line_total: 210.0, note: "30% under the US retail average." },
    { item: "pork", qty: 118, supplier: "Kroger", unit_price: 1.4, line_total: 165.2, note: "30% under the US retail average." },
    { item: "chicken", qty: 196, supplier: "Kroger", unit_price: 1.24, line_total: 243.2, note: "38% under the US retail average." },
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
