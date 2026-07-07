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

  it("renders adjusted items and reasons after forecasting", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText("cabbage")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Rain forecast lowers dine-in demand/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/18%/)).toBeInTheDocument(); // baseline_delta 0.18 -> "18%"
  });
});
