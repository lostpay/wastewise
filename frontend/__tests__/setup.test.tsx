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

  it("uses the demo dataset and advances to forecast", async () => {
    renderWithWizard(<SetupPage />);
    await userEvent.click(screen.getByRole("button", { name: /use demo dataset/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/forecast"));
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("demo");
  });

  it("shows the backend error message on a 400 upload", async () => {
    vi.spyOn(api, "uploadCsv").mockRejectedValue(new api.ApiError(400, "CSV must contain columns"));
    renderWithWizard(<SetupPage />);
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/sales csv/i), file);
    await userEvent.click(screen.getByRole("button", { name: /^upload$/i }));
    expect(await screen.findByText(/CSV must contain columns/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
