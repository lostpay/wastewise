import { describe, it, expect } from "vitest";
import { poToCsv, parseSalesHistory } from "@/lib/csv";

describe("poToCsv", () => {
  it("emits a header, one row per line, and a total row", () => {
    const csv = poToCsv(
      [{ item: "cabbage", qty: 10, unit: "1 lb", supplier: "Kroger", unit_price: 1.5, line_total: 15, note: "cheap, fresh", live: true }],
      15,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("item,qty,unit,supplier,unit_price,line_total,note");
    expect(lines[1]).toBe('cabbage,10,1 lb,Kroger,1.5,15,"cheap, fresh"'); // note with comma is quoted
    expect(lines[1]).toContain(",1 lb,");
    expect(lines[2]).toBe("Total,,,,,15,");
  });

  it("quotes item and supplier fields that contain commas or quotes", () => {
    const csv = poToCsv(
      [{ item: "beans, dried", qty: 5, supplier: 'A "Farm" Co', unit_price: 2, line_total: 10, note: "ok", live: true }],
      10,
    );
    const row = csv.trim().split("\n")[1];
    // structure must not shift: item and supplier are individually quoted/escaped
    expect(row).toBe('"beans, dried",5,,"A ""Farm"" Co",2,10,ok');
  });

  it("neutralizes CSV formula injection by prefixing a leading =, +, -, or @", () => {
    const csv = poToCsv(
      [{ item: "=cmd", qty: 1, supplier: "+1", unit_price: 1, line_total: 1, note: "@SUM(A1)", live: true }],
      1,
    );
    const row = csv.trim().split("\n")[1];
    // each formula-triggering field gets a leading apostrophe so spreadsheets treat it as text
    expect(row).toBe("'=cmd,1,,'+1,1,1,'@SUM(A1)");
  });
});

describe("parseSalesHistory", () => {
  it("parses date,item,quantity rows and skips malformed lines", () => {
    const text = "date,item,quantity\n2026-06-01,cabbage,20\n2026-06-01,pork,15\nbad,row\n2026-06-02,cabbage,22";
    const out = parseSalesHistory(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ date: "2026-06-01", item: "cabbage", quantity: 20 });
  });

  it("tolerates a price column and header case differences", () => {
    const text = "Date,Item,Quantity,Price\n2026-06-01,cabbage,20,1.5";
    expect(parseSalesHistory(text)).toEqual([{ date: "2026-06-01", item: "cabbage", quantity: 20 }]);
  });

  it("keeps only the most recent maxDays dates", () => {
    const rows = Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")},cabbage,${i}`);
    const out = parseSalesHistory(["date,item,quantity", ...rows].join("\n"), 3);
    expect(new Set(out.map((p) => p.date)).size).toBe(3);
    expect(out[0].date).toBe("2026-06-08");
  });

  it("returns [] when required headers are missing", () => {
    expect(parseSalesHistory("a,b,c\n1,2,3")).toEqual([]);
  });
});
