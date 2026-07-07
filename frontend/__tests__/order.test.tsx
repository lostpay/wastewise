import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithWizard } from "./test-utils";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import OrderPage from "@/app/order/page";
import { DEMO_SOURCING } from "@/lib/demo";

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
});
