import { describe, it, expect } from "vitest";
import { inspectCsv } from "@/components/ui/csv-dropzone";

function csvFile(name: string, body: string, type = "text/csv"): File {
  return new File([body], name, { type });
}

describe("inspectCsv", () => {
  it("accepts a valid CSV and counts data rows and columns", async () => {
    const res = await inspectCsv(
      csvFile("sales.csv", "date,item,quantity\n2026-01-01,pork,3\n2026-01-02,beef,5\n"),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.columns).toEqual(["date", "item", "quantity"]);
      expect(res.rows).toBe(2);
    }
  });

  it("rejects a non-.csv file", async () => {
    const res = await inspectCsv(csvFile("data.png", "date,item,quantity\n", "image/png"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/must be a \.csv/i);
  });

  it("rejects a CSV missing a required column", async () => {
    const res = await inspectCsv(csvFile("sales.csv", "date,item\n2026-01-01,pork\n"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/quantity/);
  });

  it("rejects a file over the size limit before reading it", async () => {
    const file = csvFile("big.csv", "date,item,quantity\n");
    Object.defineProperty(file, "size", { value: 6 * 1024 * 1024 });
    const res = await inspectCsv(file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/max is/i);
  });

  it("tolerates header casing and surrounding spaces", async () => {
    const res = await inspectCsv(csvFile("sales.csv", "Date, Item , QUANTITY\n2026-01-01,pork,3\n"));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.columns).toEqual(["date", "item", "quantity"]);
  });
});
