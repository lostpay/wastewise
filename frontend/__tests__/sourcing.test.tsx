import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SourcingPage from "@/app/sourcing/page";
import * as api from "@/lib/api";
import { DEMO_FORECAST, DEMO_SOURCING } from "@/lib/demo";

describe("Sourcing screen", () => {
  beforeEach(() => {
    // vi.spyOn(api, "runSourcing") returns the same underlying spy across
    // tests once the module method has been spied once, so its call history
    // accumulates unless explicitly cleared here -- otherwise
    // spy.mock.calls[0] in a later test can be a leftover call from an
    // earlier test rather than this test's own call.
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("redirects to forecast when no forecast is present", () => {
    renderWithWizard(<SourcingPage />);
    expect(push).toHaveBeenCalledWith("/forecast");
  });

  it("sources using adjusted quantities and shows savings", async () => {
    const spy = vi.spyOn(api, "runSourcing").mockResolvedValue(DEMO_SOURCING);
    renderWithWizard(<SourcingPage />, { initial: { datasetId: "demo", forecast: DEMO_FORECAST } });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // called with {item, qty: adjusted_qty} pairs
    expect(spy.mock.calls[0][0]).toEqual([
      { item: "cabbage", qty: 150 },
      { item: "pork", qty: 118 },
      { item: "chicken", qty: 196 },
    ]);
    expect(await screen.findAllByText("Kroger")).toHaveLength(3);
    expect(screen.getByText(/\$92/)).toBeInTheDocument(); // savings
  });

  it("surfaces a 4xx error inline instead of an infinite skeleton", async () => {
    vi.spyOn(api, "runSourcing").mockRejectedValue(new api.ApiError(422, "Invalid location"));
    renderWithWizard(<SourcingPage />, { initial: { datasetId: "demo", forecast: DEMO_FORECAST } });
    expect(await screen.findByText("Invalid location")).toBeInTheDocument();
  });

  it("passes datasetId through so sourcing can fall back to historical prices for unmatched items", async () => {
    const spy = vi.spyOn(api, "runSourcing").mockResolvedValue(DEMO_SOURCING);
    renderWithWizard(<SourcingPage />, { initial: { datasetId: "abc123", forecast: DEMO_FORECAST } });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][2]).toBe("abc123");
  });
});
