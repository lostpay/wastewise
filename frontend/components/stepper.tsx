"use client";

import Link from "next/link";
import { useContext } from "react";
import { usePathname } from "next/navigation";
import { WizardContext } from "@/lib/store";

interface Step {
  key: string;
  label: string;
  description: string;
  href: string;
}

const STEPS: Step[] = [
  { key: "setup", label: "Setup", description: "Initialize demand engines", href: "/setup" },
  { key: "forecast", label: "Forecast", description: "Analyze upcoming demand", href: "/forecast" },
  { key: "sourcing", label: "Sourcing", description: "Optimize supplier routes", href: "/sourcing" },
  { key: "order", label: "Order", description: "Review and dispatch orders", href: "/order" },
];

export function Stepper({ current }: { current?: number } = {}) {
  // Stepper is used both inside the wizard (with context) and in isolated tests
  // (without). Tolerate the missing provider so `<Stepper current={0} />` still
  // renders — the sidebar just runs with defaults.
  const wizard = useContext(WizardContext);
  const pathname = usePathname();
  const horizon = wizard?.horizon;
  const location = wizard?.location;
  const datasetId = wizard?.datasetId ?? null;
  const forecast = wizard?.forecast ?? null;
  const sourcing = wizard?.sourcing ?? null;

  // A step is jumpable back to only if we've already collected the state that
  // downstream guards require (see each page's redirect in useEffect).
  const maxReached = sourcing ? 3 : forecast ? 2 : datasetId ? 1 : 0;

  const routeIdx = STEPS.findIndex((s) => s.href === pathname);
  const currentIdx = typeof current === "number" ? current : routeIdx >= 0 ? routeIdx : 0;

  return (
    <nav aria-label="Progress" className="flex h-full flex-col justify-between py-2">
      <div>
        <p className="mb-6 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Workflow Pipeline
        </p>
        <ol className="relative ml-2 space-y-6 border-l border-zinc-200/80">
          {STEPS.map((s, i) => {
            const isActive = i === currentIdx;
            const isDone = i < currentIdx;
            const canJump = i <= maxReached && !isActive;

            const dot = (
              <span
                className={`absolute -left-[5px] top-1.5 flex h-2.5 w-2.5 items-center justify-center rounded-full transition-all duration-300 ${
                  isActive
                    ? "scale-110 bg-emerald-700 ring-4 ring-emerald-100"
                    : isDone
                      ? "bg-emerald-600"
                      : "bg-zinc-200 group-hover:bg-zinc-300"
                }`}
              />
            );

            const body = (
              <div className="flex flex-col">
                <span
                  className={`text-xs font-semibold tracking-tight transition-colors ${
                    isActive
                      ? "font-bold text-zinc-900"
                      : isDone
                        ? "text-zinc-600"
                        : "text-zinc-400"
                  }`}
                >
                  {s.label}
                </span>
                <span className="mt-0.5 hidden text-[11px] leading-snug text-zinc-400 md:block">
                  {s.description}
                </span>
              </div>
            );

            return (
              <li
                key={s.key}
                aria-current={isActive ? "step" : undefined}
                className="group relative mb-0 pl-6"
              >
                {dot}
                {canJump ? (
                  <Link
                    href={s.href}
                    className="-ml-1 block rounded-md py-0.5 pl-1 transition-colors hover:bg-zinc-50"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="py-0.5">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {(datasetId || horizon || location) && (
        <div className="mt-8 hidden space-y-2.5 border-t border-zinc-200/60 pt-6 text-[11px] text-zinc-500 md:block">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">
            Active Parameters
          </p>
          {horizon && (
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Horizon:</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono capitalize text-zinc-700">
                {horizon}
              </span>
            </div>
          )}
          {location && (
            <div className="flex items-start justify-between">
              <span className="text-zinc-400">Coordinates:</span>
              <span className="max-w-[120px] truncate text-right font-mono text-zinc-700">
                {location}
              </span>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
