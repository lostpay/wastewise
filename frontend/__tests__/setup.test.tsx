import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SetupPage from "@/app/setup/page";
import * as api from "@/lib/api";

describe("Setup screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("uploads a CSV and advances to forecast", async () => {
    vi.spyOn(api, "uploadCsv").mockResolvedValue({
      dataset_id: "ds1",
      summary: { dataset_id: "ds1", n_rows: 1, items: ["pork"], start_date: "2026-01-01", end_date: "2026-01-01" },
    });
    renderWithWizard(<SetupPage />);
    const file = new File(["date,item,quantity\n2026-01-01,pork,1\n"], "sales.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/sales csv/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^upload/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/forecast"));
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("ds1");
  });

  it("clears prior forecast/sourcing/rationale when a new dataset is loaded", async () => {
    vi.spyOn(api, "uploadCsv").mockResolvedValue({
      dataset_id: "ds2",
      summary: { dataset_id: "ds2", n_rows: 1, items: ["pork"], start_date: "2026-01-01", end_date: "2026-01-01" },
    });
    // Seed state as if a previous run already produced results.
    renderWithWizard(<SetupPage />, {
      initial: {
        datasetId: "old",
        forecast: { baseline_delta: 0.1, items: [{ item: "pork", forecast: 1, adjusted_qty: 1, reason: "", live: true }] },
        sourcing: { total: 9, savings: 1, lines: [] },
        rationale: { paragraph: "Stale rationale from the prior dataset.", live: true },
      },
    });
    const file = new File(["date,item,quantity\n2026-01-01,pork,1\n"], "sales.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/sales csv/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^upload/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/forecast"));
    const state = JSON.parse(window.sessionStorage.getItem("ww_state")!);
    expect(state.datasetId).toBe("ds2");
    expect(state.forecast).toBeNull();
    expect(state.sourcing).toBeNull();
    expect(state.rationale).toBeNull();
  });

  it("shows the backend error message on a 400 upload", async () => {
    vi.spyOn(api, "uploadCsv").mockRejectedValue(new api.ApiError(400, "CSV must contain columns"));
    renderWithWizard(<SetupPage />);
    // Client-side validation checks the header row for required columns, so the
    // file must at least have those to reach the backend where the mocked error fires.
    const file = new File(["date,item,quantity\n2026-01-01,pork,1\n"], "bad.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/sales csv/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^upload/i }));
    expect(await screen.findByText(/CSV must contain columns/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
