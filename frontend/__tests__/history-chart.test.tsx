import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Recharts needs a sized container; stub ResponsiveContainer to render children.
vi.mock("recharts", async (orig) => {
  const actual = await orig<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 400 }}>{children}</div>
    ),
  };
});

import { HistoryChart } from "@/components/history-chart";
import type { ForecastAdjustedItem, HistoryPoint } from "@/lib/types";

const items: ForecastAdjustedItem[] = [
  { item: "cabbage", forecast: 100, adjusted_qty: 90, reason: "r", live: true, daily: [1, 2, 3] },
  { item: "pork", forecast: 80, adjusted_qty: 70, reason: "r", live: true, daily: [4, 5, 6] },
];
// History for cabbage only — pork has none.
const history: HistoryPoint[] = [
  { date: "2026-06-01", item: "cabbage", quantity: 10 },
  { date: "2026-06-02", item: "cabbage", quantity: 12 },
];

describe("HistoryChart", () => {
  it("keeps the item selector usable when the chosen item has no history", async () => {
    render(<HistoryChart history={history} items={items} />);
    const select = screen.getByLabelText(/chart item/i);
    expect(select).toBeInTheDocument();

    // Switch to pork, which has no history rows: the card (and its selector)
    // must stay mounted and show an empty state instead of vanishing.
    await userEvent.selectOptions(select, "pork");
    expect(screen.getByLabelText(/chart item/i)).toBeInTheDocument();
    expect(screen.getByText(/no sales history/i)).toBeInTheDocument();
  });
});
