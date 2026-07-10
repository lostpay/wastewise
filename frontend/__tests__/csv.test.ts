import { describe, it, expect } from "vitest";
import { poToCsv } from "@/lib/csv";

describe("poToCsv", () => {
  it("emits a header, one row per line, and a total row", () => {
    const csv = poToCsv(
      [{ item: "cabbage", qty: 10, supplier: "Kroger", unit_price: 1.5, line_total: 15, note: "cheap, fresh", live: true }],
      15,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("item,qty,supplier,unit_price,line_total,note");
    expect(lines[1]).toBe('cabbage,10,Kroger,1.5,15,"cheap, fresh"'); // note with comma is quoted
    expect(lines[2]).toBe("Total,,,,15,");
  });

  it("quotes item and supplier fields that contain commas or quotes", () => {
    const csv = poToCsv(
      [{ item: "beans, dried", qty: 5, supplier: 'A "Farm" Co', unit_price: 2, line_total: 10, note: "ok", live: true }],
      10,
    );
    const row = csv.trim().split("\n")[1];
    // structure must not shift: item and supplier are individually quoted/escaped
    expect(row).toBe('"beans, dried",5,"A ""Farm"" Co",2,10,ok');
  });

  it("neutralizes CSV formula injection by prefixing a leading =, +, -, or @", () => {
    const csv = poToCsv(
      [{ item: "=cmd", qty: 1, supplier: "+1", unit_price: 1, line_total: 1, note: "@SUM(A1)", live: true }],
      1,
    );
    const row = csv.trim().split("\n")[1];
    // each formula-triggering field gets a leading apostrophe so spreadsheets treat it as text
    expect(row).toBe("'=cmd,1,'+1,1,1,'@SUM(A1)");
  });
});
