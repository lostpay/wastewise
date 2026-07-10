import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReasonBadge } from "@/components/reason-badge";

describe("ReasonBadge", () => {
  it("renders the live AI badge with the reason when live", () => {
    render(<ReasonBadge reason="Rain drives comfort-food orders up." live={true} />);
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Rain drives comfort-food orders up.")).toBeInTheDocument();
  });

  it("renders a visually distinct unavailable state when not live, without the AI chip", () => {
    render(<ReasonBadge reason="AI reasoning unavailable — using base forecast." live={false} />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
