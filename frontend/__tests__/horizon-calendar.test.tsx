import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HorizonCalendar } from "@/components/ui/horizon-calendar";

describe("HorizonCalendar", () => {
  it("shows the selected length in the caption", () => {
    render(<HorizonCalendar start="2026-06-01" days={7} onChange={() => {}} />);
    expect(screen.getByText(/7 days/)).toBeInTheDocument();
  });

  it("reports the length in days when an end date in range is clicked", async () => {
    const onChange = vi.fn();
    // start 2026-06-01, maxDays 14 -> selectable June 1..June 14
    render(<HorizonCalendar start="2026-06-01" days={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "10" })); // June 10
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("disables days beyond the maxDays window", async () => {
    const onChange = vi.fn();
    render(<HorizonCalendar start="2026-06-01" days={1} maxDays={14} onChange={onChange} />);
    const beyond = screen.getByRole("button", { name: "20" }); // June 20 > June 14
    expect(beyond).toBeDisabled();
    await userEvent.click(beyond);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a single day as '1 day' (singular)", () => {
    render(<HorizonCalendar start="2026-06-01" days={1} onChange={() => {}} />);
    expect(screen.getByText(/1 day\b/)).toBeInTheDocument();
  });
});
