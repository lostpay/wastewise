import type { POLine } from "./types";

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
