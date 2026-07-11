import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WizardProvider } from "@/lib/store";
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
import { DEMO_FORECAST, DEMO_HISTORY } from "@/lib/demo";

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

  it("shows the waste-avoided tile when the backtest reports savings", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, { initial: { datasetId: "demo" } });
    expect(await screen.findByText(/\$61\.50/)).toBeInTheDocument();
    // Both the tile label and the methodology disclosure mention "Waste
    // avoided"; either is enough to prove the tile rendered.
    expect(screen.getAllByText(/waste avoided/i).length).toBeGreaterThan(0);
  });

  it("does not double-fire runForecast under React 18 StrictMode dev double-invoke", async () => {
    // Regression guard for the "latch reset" fix: an unconditional reset
    // effect would flip `started.current` back to false between StrictMode's
    // two mounts, causing runForecast to be called twice per page load.
    window.sessionStorage.setItem("ww_state", JSON.stringify({ datasetId: "demo" }));
    // Fresh spy so counts don't include prior tests' fires.
    vi.restoreAllMocks();
    const spy = vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    render(
      <StrictMode>
        <WizardProvider>
          <ForecastPage />
        </WizardProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Give any lingering StrictMode remount + effect a chance to fire again.
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("renders the history-vs-forecast chart when history is present", async () => {
    vi.spyOn(api, "runForecast").mockResolvedValue(DEMO_FORECAST);
    renderWithWizard(<ForecastPage />, {
      initial: { datasetId: "demo", history: DEMO_HISTORY },
    });
    expect(await screen.findByText(/sales history & forecast/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/chart item/i)).toBeInTheDocument();
  });
});
