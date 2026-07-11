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
    expect(result.current.horizonDays).toBe(7);
    expect(result.current.datasetId).toBeNull();
  });

  it("merges and persists updates to sessionStorage", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    act(() => result.current.set({ datasetId: "abc123" }));
    expect(result.current.datasetId).toBe("abc123");
    expect(JSON.parse(window.sessionStorage.getItem("ww_state")!).datasetId).toBe("abc123");
  });

  it("rehydrates persisted state on mount", () => {
    window.sessionStorage.setItem("ww_state", JSON.stringify({ datasetId: "seed", horizonDays: 3 }));
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.datasetId).toBe("seed");
    expect(result.current.horizonDays).toBe(3);
  });

  it("exposes a reactive hydrated flag that becomes true after mount", () => {
    const { result } = renderHook(() => useWizard(), { wrapper });
    expect(result.current.hydrated).toBe(true);
  });

  it("recovers from a corrupt persisted state instead of wedging hydration", () => {
    window.sessionStorage.setItem("ww_state", "{not valid json");
    const { result } = renderHook(() => useWizard(), { wrapper });
    // hydration still completes (no thrown effect), defaults are used, and the bad value is dropped
    expect(result.current.hydrated).toBe(true);
    expect(result.current.datasetId).toBeNull();
    expect(result.current.location).toBe("40.7,-74.0");
    expect(window.sessionStorage.getItem("ww_state")).toBeNull();
  });
});
