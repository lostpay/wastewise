import type { UploadResponse, ForecastResponse, SourcingResponse, RationaleResponse, HistoryPoint } from "./types";

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
  waste_avoided_units: 34,
  waste_avoided_value: 61.5,
  items: [
    { item: "cabbage", forecast: 168.0, adjusted_qty: 150.0, live: true,
      daily: [22, 23, 22, 24, 25, 26, 26],
      reason: "Rain forecast lowers dine-in demand for fresh-cut sides like cabbage slaw." },
    { item: "pork", forecast: 126.0, adjusted_qty: 118.0, live: true,
      daily: [17, 18, 17, 18, 18, 19, 19],
      reason: "Rain dampens dine-in traffic, but pork's use in stews softens the drop." },
    { item: "chicken", forecast: 210.0, adjusted_qty: 196.0, live: true,
      daily: [28, 29, 29, 30, 31, 31, 32],
      reason: "Rain lowers dine-in demand most for quick-grill items like chicken." },
  ],
};

export const DEMO_HISTORY: HistoryPoint[] = (() => {
  const out: HistoryPoint[] = [];
  const base: Record<string, number> = { cabbage: 22, chicken: 30, pork: 18 };
  const start = new Date("2026-06-02T00:00:00Z");
  for (let d = 0; d < 28; d++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + d);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    for (const item of Object.keys(base)) {
      const wave = Math.sin((d + item.length) * 1.1) * 3;
      out.push({
        date: day.toISOString().slice(0, 10),
        item,
        quantity: Math.round((base[item] + (weekend ? 8 : 0) + wave) * 10) / 10,
      });
    }
  }
  return out;
})();

export const DEMO_SOURCING: SourcingResponse = {
  total: 618.4,
  savings: 92.0,
  lines: [
    { item: "cabbage", qty: 150, unit: "1 lb", supplier: "Kroger", unit_price: 1.4, line_total: 210.0, live: true, note: "30% under the US retail average." },
    { item: "pork", qty: 118, unit: "1 lb", supplier: "Kroger", unit_price: 1.4, line_total: 165.2, live: true, note: "30% under the US retail average." },
    { item: "chicken", qty: 196, unit: "1 lb", supplier: "Kroger", unit_price: 1.24, line_total: 243.2, live: true, note: "38% under the US retail average." },
  ],
};

export const DEMO_RATIONALE: RationaleResponse = {
  paragraph:
    "This week's rain forecast lowers dine-in traffic across the board, though " +
    "pork's role in stews softens its drop compared to lighter fare like chicken " +
    "and cabbage sides. Sourcing found Kroger listings for all three items " +
    "running 30-38% under the US retail average, saving $92.00 on a $618.40 order.",
  live: true,
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

const SERVED_KEY = "ww_demo_served";

export function markDemoServed(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SERVED_KEY, "1");
  window.dispatchEvent(new Event("ww:demo-served"));
}

export function clearDemoServed(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SERVED_KEY);
  window.dispatchEvent(new Event("ww:demo-cleared"));
}

export function demoWasServed(): boolean {
  return typeof window !== "undefined" && window.sessionStorage.getItem(SERVED_KEY) === "1";
}
