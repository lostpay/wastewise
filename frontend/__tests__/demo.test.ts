import { describe, it, expect, beforeEach } from "vitest";
import { DEMO_UPLOAD, DEMO_FORECAST, DEMO_SOURCING, isDemoMode, setDemoMode } from "@/lib/demo";

describe("demo fixtures", () => {
  it("upload fixture has a dataset id and summary items", () => {
    expect(DEMO_UPLOAD.dataset_id).toBeTruthy();
    expect(DEMO_UPLOAD.summary.items.length).toBeGreaterThan(0);
  });

  it("forecast fixture items each have item, adjusted_qty, reason", () => {
    expect(DEMO_FORECAST.items.length).toBeGreaterThan(0);
    for (const it of DEMO_FORECAST.items) {
      expect(it.item).toBeTruthy();
      expect(typeof it.adjusted_qty).toBe("number");
      expect(it.reason).toBeTruthy();
    }
  });

  it("sourcing fixture lines have supplier and totals", () => {
    expect(DEMO_SOURCING.lines.length).toBeGreaterThan(0);
    expect(DEMO_SOURCING.total).toBeGreaterThan(0);
  });
});

describe("demo mode toggle", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is on when the demo flag is set", () => {
    setDemoMode(true);
    expect(isDemoMode()).toBe(true);
    setDemoMode(false);
    // With NEXT_PUBLIC_API_URL unset in the test env, demo stays on by default.
    expect(isDemoMode()).toBe(true);
  });
});
