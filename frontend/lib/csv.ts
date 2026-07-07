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
