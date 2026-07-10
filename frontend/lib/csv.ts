import type { POLine, HistoryPoint } from "./types";

function esc(v: string): string {
  // Neutralize CSV formula injection: a spreadsheet treats a leading =, +, -, or @
  // as a formula, so prefix an apostrophe to force text.
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function poToCsv(lines: POLine[], total: number): string {
  const header = "item,qty,unit,supplier,unit_price,line_total,note";
  const rows = lines.map((l) =>
    [esc(l.item), l.qty, esc(l.unit ?? ""), esc(l.supplier), l.unit_price, l.line_total, esc(l.note)].join(","),
  );
  return [header, ...rows, `Total,,,,,${total},`].join("\n");
}

// Client-side mirror of the backend's ingest schema (date,item,quantity[,price]).
// Keeps only the most recent maxDays dates so sessionStorage stays small.
export function parseSalesHistory(text: string, maxDays = 60): HistoryPoint[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const di = header.indexOf("date");
  const ii = header.indexOf("item");
  const qi = header.indexOf("quantity");
  if (di < 0 || ii < 0 || qi < 0) return [];
  const points: HistoryPoint[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = cols[di]?.trim();
    const item = cols[ii]?.trim();
    const quantity = Number(cols[qi]);
    if (!date || !item || !Number.isFinite(quantity)) continue;
    points.push({ date, item, quantity });
  }
  const dates = [...new Set(points.map((p) => p.date))].sort();
  const keep = new Set(dates.slice(-maxDays));
  return points.filter((p) => keep.has(p.date));
}
