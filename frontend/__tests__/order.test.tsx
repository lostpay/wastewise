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

  it("recomputes line and grand totals when a quantity is edited", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    expect(screen.getByText(/\$140\.00/)).toBeInTheDocument(); // 100 × $1.40
    expect(screen.getByText(/\$548\.40/)).toBeInTheDocument(); // 140 + 165.2 + 243.2
  });

  it("un-approves when the order changes after approval", async () => {
    renderWithWizard(<OrderPage />, { initial: { datasetId: "demo", sourcing: DEMO_SOURCING } });
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    expect(screen.getByRole("button", { name: /^approve$/i })).not.toBeDisabled();
  });

  it("drops the stale AI rationale when a quantity is edited", async () => {
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING, rationale: DEMO_RATIONALE },
    });
    // Rationale is visible on load (its cited totals match the sourced order).
    expect(screen.getByText(/dine-in traffic across the board/i)).toBeInTheDocument();
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    // Editing the order makes the rationale's totals stale, so it is removed
    // rather than left contradicting the recomputed table.
    expect(screen.queryByText(/dine-in traffic across the board/i)).not.toBeInTheDocument();
  });

  it("does not let a rationale fetch that resolves after an edit overwrite the invalidated rationale", async () => {
    let resolveRationale!: (value: typeof DEMO_RATIONALE) => void;
    const pending = new Promise<typeof DEMO_RATIONALE>((resolve) => {
      resolveRationale = resolve;
    });
    vi.spyOn(api, "runRationale").mockReturnValue(pending);
    renderWithWizard(<OrderPage />, {
      initial: { datasetId: "demo", forecast: DEMO_FORECAST, sourcing: DEMO_SOURCING },
    });
    // The rationale fetch is in flight (mock never resolves yet). Edit the
    // order before it settles -- this is the invalidating action.
    const input = screen.getByLabelText(/quantity for cabbage/i);
    await userEvent.clear(input);
    await userEvent.type(input, "100");
    expect(screen.queryByText(/dine-in traffic across the board/i)).not.toBeInTheDocument();
    // Now let the stale fetch resolve. It must be dropped, not reinstate the
    // rationale computed against the pre-edit order.
    resolveRationale(DEMO_RATIONALE);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/dine-in traffic across the board/i)).not.toBeInTheDocument();
  });
});
