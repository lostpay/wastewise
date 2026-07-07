import { describe, it, expect, beforeEach } from "vitest";
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { WizardProvider, useWizard } from "@/lib/store";

const wrapper = ({ children }: { children: React.ReactNode }) => <WizardProvider>{children}</WizardProvider>;

describe("wizard store", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("exposes sensible defaults", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.location).toBe("40.7,-74.0");
    expect(result.current.horizon).toBe("week");
    expect(result.current.datasetId).toBeNull();
  });

  it("merges and persists updates to sessionStorage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    act(() => result.current.set({ datasetId: "abc123" }));
    expect(result.current.datasetId).toBe("abc123");
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("abc123");
  });

  it("rehydrates persisted state on mount", () => {
    window.sessionStorage.setItem("ww_state", JSON.stringify({ datasetId: "seed", horizon: "day" }));
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.datasetId).toBe("seed");
    expect(result.current.horizon).toBe("day");
  });
});
