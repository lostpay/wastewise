export type Currency = "USD" | "INR" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD" | "CNY";

export const CURRENCY_OPTIONS: { code: Currency; label: string }[] = [
  { code: "USD", label: "US dollar (USD)" },
  { code: "INR", label: "Indian rupee (INR)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "GBP", label: "British pound (GBP)" },
  { code: "JPY", label: "Japanese yen (JPY)" },
  { code: "CAD", label: "Canadian dollar (CAD)" },
  { code: "AUD", label: "Australian dollar (AUD)" },
  { code: "CNY", label: "Chinese yuan (CNY)" },
];

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
  live: boolean;
  daily?: number[];
  // Buffered recommendation before the AI adjustment. Optional: demo
  // fixtures and old persisted sessions don't have it — fall back to forecast.
  recommended?: number;
  spoilage_risk?: string;          // "high" | "medium" | "low" | ""
  shelf_life_days?: number | null;
}

export interface AdjustmentSummary {
  n_up: number;
  n_down: number;
  n_unchanged: number;
  net_delta_pct: number;
}

export interface HistoryPoint {
  date: string;
  item: string;
  quantity: number;
}

export interface HoldoutDay {
  date: string;
  actual: number;
  model: number;
  baseline: number;
  waste_model_value?: number | null;
  waste_baseline_value?: number | null;
}

export interface ForecastResponse {
  items: ForecastAdjustedItem[];
  baseline_delta: number;
  waste_avoided_units?: number;
  waste_avoided_value?: number | null;
  adjustment?: AdjustmentSummary | null;
  holdout_daily?: HoldoutDay[];
}

export interface POLine {
  item: string;
  qty: number;
  supplier: string;
  unit_price: number;
  line_total: number;
  note: string;
  live: boolean;
  // US retail average (BLS via FRED) in USD, or null when the item has no
  // real US benchmark (historical fallback or nothing).
  benchmark: number | null;
  unit?: string;
  flagged?: boolean;
}

export interface SourcingResponse {
  lines: POLine[];
  total: number;
  savings: number;
  overpay?: number;
}

export interface RationaleResponse {
  paragraph: string;
  live: boolean;
}

export interface WhatIfResponse {
  lines: POLine[];
  total: number;
  reply: string;
  live: boolean;
}
