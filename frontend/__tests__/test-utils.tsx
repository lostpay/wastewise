import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { WizardProvider } from "@/lib/store";

export function renderWithWizard(ui: ReactElement, opts?: { initial?: Record<string, unknown> }) {
  if (opts?.initial) window.sessionStorage.setItem("ww_state", JSON.stringify(opts.initial));
  return render(<WizardProvider>{ui}</WizardProvider>);
}

export * from "@testing-library/react";
