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
