import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stepper } from "@/components/stepper";

describe("Stepper", () => {
  it("renders the four step labels", () => {
    render(<Stepper current={0} />);
    for (const label of ["Setup", "Forecast", "Sourcing", "Order"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks the current step with aria-current", () => {
    render(<Stepper current={2} />);
    expect(screen.getByText("Sourcing").closest("[aria-current]")).toHaveAttribute("aria-current", "step");
  });
});
