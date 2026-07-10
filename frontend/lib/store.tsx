"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { DatasetSummary, ForecastResponse, SourcingResponse, RationaleResponse, Horizon, Currency } from "./types";

const KEY = "ww_state";

interface WizardState {
  location: string;
  horizon: Horizon;
  currency: Currency;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
  rationale: RationaleResponse | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  currency: "USD",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
  rationale: null,
};

interface WizardContextValue extends WizardState {
  hydrated: boolean;
  set: (partial: Partial<WizardState>) => void;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
      // Parse eagerly (not inside the setState updater) so a corrupt value throws
      // here, where the catch can handle it, rather than later in the reducer.
      if (raw) {
        const restored = JSON.parse(raw) as Partial<WizardState>;
        setState((s) => ({ ...s, ...restored }));
      }
    } catch {
      // Corrupt persisted state must not wedge hydration — drop it and fall back to defaults.
      if (typeof window !== "undefined") window.sessionStorage.removeItem(KEY);
    }
    setHydrated(true);
  }, []);

  const set = (partial: Partial<WizardState>) =>
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") window.sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

  return <WizardContext.Provider value={{ ...state, hydrated, set }}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
