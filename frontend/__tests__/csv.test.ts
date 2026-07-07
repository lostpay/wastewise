import { describe, it, expect } from "vitest";
import { poToCsv } from "@/lib/csv";

describe("poToCsv", () => {
  it("emits a header, one row per line, and a total row", () => {
    const csv = poToCsv(
      [{ item: "cabbage", qty: 10, supplier: "Kroger", unit_price: 1.5, line_total: 15, note: "cheap, fresh" }],
      15,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("item,qty,supplier,unit_price,line_total,note");
    expect(lines[1]).toBe('cabbage,10,Kroger,1.5,15,"cheap, fresh"'); // note with comma is quoted
    expect(lines[2]).toBe("Total,,,,15,");
  });
});
