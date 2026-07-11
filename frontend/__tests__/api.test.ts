import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { uploadCsv, runForecast, runSourcing, ApiError } from "@/lib/api";
import { DEMO_FORECAST, DEMO_SOURCING } from "@/lib/demo";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on a 200", async () => {
    const body = { items: [{ item: "cabbage", forecast: 10, adjusted_qty: 9, reason: "x" }], baseline_delta: 0.1 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    const res = await runForecast("ds1", 7, "40.7,-74.0");
    expect(res.items[0].item).toBe("cabbage");
  });

  it("falls back to the demo fixture when fetch throws (backend offline)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await runForecast("ds1", 7, "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
  });

  it("falls back to the demo fixture on HTTP 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const res = await runForecast("ds1", 7, "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
  });

  it("throws ApiError with the detail on a 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "bad csv" }, 400)));
    const file = new File(["x"], "s.csv", { type: "text/csv" });
    await expect(uploadCsv(file)).rejects.toMatchObject({ status: 400, message: "bad csv" } as ApiError);
  });

  it("returns the fixture in demo mode without fetching", async () => {
    window.sessionStorage.setItem("ww_demo", "1");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await runForecast("ds1", 7, "40.7,-74.0");
    expect(res).toEqual(DEMO_FORECAST);
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends currency + dataset_id in the sourcing request body", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse(DEMO_SOURCING));
    vi.stubGlobal("fetch", spy);
    await runSourcing([{ item: "onion", qty: 5 }], "40.7,-74.0", "ds123", "INR");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.currency).toBe("INR");
    expect(body.dataset_id).toBe("ds123");
  });

  it("defaults currency to USD when the caller omits it", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse(DEMO_SOURCING));
    vi.stubGlobal("fetch", spy);
    await runSourcing([{ item: "onion", qty: 5 }], "40.7,-74.0", "ds123");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.currency).toBe("USD");
  });

  it("sends horizon_days in the forecast request body", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ items: [], baseline_delta: 0 }));
    vi.stubGlobal("fetch", spy);
    await runForecast("ds1", 10, "40.7,-74.0");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.horizon_days).toBe(10);
    expect(body.dataset_id).toBe("ds1");
  });
});
