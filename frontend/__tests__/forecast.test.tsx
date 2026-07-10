import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// Recharts needs a sized container; stub ResponsiveContainer to render children.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 800, height: 400 }}>{children}</div> };
});

import ForecastPage from "@/app/forecast/page";
import * as api from "@/lib/api";
import { DEMO_FORECAST } from "@/lib/demo";

describe("Forecast screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("redirects to setup when no dataset is loaded", () => {
    renderWithWizard(<ForecastPage />);
    expect(push).toHaveBeenCalledWith("/setup");
  });

  it("renders adjusted items with genuinely different per-item reasons after forecasting", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("cabbage")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText(/fresh-cut sides like cabbage slaw/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/pork's use in stews softens the drop/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/quick-grill items like chicken/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/18%/)).toBeInTheDocument(); // baseline_delta 0.18 -> "18%"
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /model/i })).toBeInTheDocument();
  });

  it("surfaces a 4xx error inline instead of an infinite skeleton", async () => {
    vi.spyOn(api, "runForecast").mockRejectedValue(new api.ApiError(422, "Invalid location"));
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("Invalid location")).toBeInTheDocument();
  });

  it("does not redirect to setup when persisted state has a valid dataset (hydration gate)", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    // give any pending microtasks/effects a chance to run
    await waitFor(() => expect(screen.queryByText("cabbage")).toBeInTheDocument());
    expect(push).not.toHaveBeenCalledWith("/setup");
  });
});
