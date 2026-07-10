import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import OrderPage from "@/app/order/page";
import { DEMO_FORECAST, DEMO_SOURCING, DEMO_RATIONALE } from "@/lib/demo";
import * as api from "@/lib/api";

describe("Order screen", () => {
  beforeEach(() => {
    push.mockReset();
    window.sessionStorage.clear();
  });

  it("redirects to sourcing when no sourcing result is present", () => {
    renderWithWizard(<OrderPage />);
    expect(push).toHaveBeenCalledWith("/sourcing");
  });

  it("renders the PO with a grand total and an approve action", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    expect(screen.getByText("cabbage")).toBeInTheDocument();
    expect(screen.getByText(/\$618\.40/)).toBeInTheDocument(); // grand total
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it("fetches and renders the purchasing rationale between the header and the PO table", async () => {
    vi.spyOn(api, "runRationale").mockResolvedValue(DEMO_RATIONALE);
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING },
    });
    expect(await screen.findByText(/dine-in traffic across the board/i)).toBeInTheDocument();
    expect(screen.getByText("AI synthesis")).toBeInTheDocument();
  });

  it("never gates Approve on the rationale call", async () => {
    vi.spyOn(api, "runRationale").mockImplementation(() => new Promise(() => {})); // never resolves
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING },
    });
    const approveButton = await screen.findByRole("button", { name: /approve/i });
    expect(approveButton).not.toBeDisabled();
  });
});
