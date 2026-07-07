"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { DatasetSummary, ForecastResponse, SourcingResponse, Horizon } from "./types";

const KEY = "ww_state";

interface WizardState {
  location: string;
  horizon: Horizon;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizon: "week",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
};

interface WizardContextValue extends WizardState {
  set: (partial: Partial<WizardState>) => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WizardState>(DEFAULTS);
  const hydrated = useRef(false);

  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
    if (raw) setState((s) => ({ ...s, ...JSON.parse(raw) }));
    hydrated.current = true;
  }, []);

  const set = (partial: Partial<WizardState>) =>
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined") window.sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

  return <WizardContext.Provider value={{ ...state, set }}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
