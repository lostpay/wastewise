"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
} from "react";
import type {
  DatasetSummary,
  ForecastResponse,
  SourcingResponse,
  RationaleResponse,
  Currency,
  HistoryPoint,
} from "./types";

const KEY = "ww_state";

interface WizardState {
  location: string;
  horizonDays: number;
  currency: Currency;
  datasetId: string | null;
  summary: DatasetSummary | null;
  forecast: ForecastResponse | null;
  sourcing: SourcingResponse | null;
  rationale: RationaleResponse | null;
  history: HistoryPoint[] | null;
}

const DEFAULTS: WizardState = {
  location: "40.7,-74.0",
  horizonDays: 7,
  currency: "USD",
  datasetId: null,
  summary: null,
  forecast: null,
  sourcing: null,
  rationale: null,
  history: null,
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
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        const restored = JSON.parse(raw) as Partial<WizardState>;
        startTransition(() => {
          setState((prev) => ({ ...prev, ...restored }));
        });
      }
    } catch {
      window.sessionStorage.removeItem(KEY);
    }
    startTransition(() => setHydrated(true));
  }, []);

  const set = (partial: Partial<WizardState>) =>
    setState((prev) => {
      const next = { ...prev, ...partial };
      if (typeof window !== "undefined")
        window.sessionStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });

  return (
    <WizardContext.Provider value={{ ...state, hydrated, set }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
