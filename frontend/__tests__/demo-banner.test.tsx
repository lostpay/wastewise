import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { DemoBanner } from "@/components/demo-banner";
import { markDemoServed, clearDemoServed, demoWasServed } from "@/lib/demo";

describe("DemoBanner", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("renders nothing until demo data has been served", () => {
    render(<DemoBanner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears when a demo fixture is served and disappears on clear", () => {
    render(<DemoBanner />);
    act(() => markDemoServed());
    expect(screen.getByRole("status")).toHaveTextContent(/demo data/i);
    act(() => clearDemoServed());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tracks served state in sessionStorage", () => {
    expect(demoWasServed()).toBe(false);
    markDemoServed();
    expect(demoWasServed()).toBe(true);
  });
});
