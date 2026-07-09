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
  { key: "setup", label: "Setup", description: "Load history & location", href: "/setup" },
  { key: "forecast", label: "Forecast", description: "Predict demand", href: "/forecast" },
  { key: "sourcing", label: "Sourcing", description: "Compare prices", href: "/sourcing" },
  { key: "order", label: "Order", description: "Approve & export", href: "/order" },
];

export function Stepper({ current }: { current?: number } = {}) {
  const wizard = useContext(WizardContext);
  const pathname = usePathname();
  const horizon = wizard?.horizon;
  const location = wizard?.location;
  const datasetId = wizard?.datasetId ?? null;
  const forecast = wizard?.forecast ?? null;
  const sourcing = wizard?.sourcing ?? null;

  const maxReached = sourcing ? 3 : forecast ? 2 : datasetId ? 1 : 0;
  const routeIdx = STEPS.findIndex((s) => s.href === pathname);
  const currentIdx = typeof current === "number" ? current : routeIdx >= 0 ? routeIdx : 0;

  return (
    <nav aria-label="Progress" className="flex h-full flex-col justify-between">
      <div>
        <p className="ww-label mb-4">§ Procedure</p>
        <ol className="space-y-0 border-t border-foreground/15">
          {STEPS.map((s, i) => {
            const isActive = i === currentIdx;
            const isDone = i < currentIdx;
            const canJump = i <= maxReached && !isActive;
            const num = String(i + 1).padStart(2, "0");

            const inner = (
              <div
                className={`group flex items-start gap-3 border-b border-foreground/15 py-3 pl-3 pr-2 transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : canJump
                      ? "hover:bg-foreground/5"
                      : ""
                }`}
              >
                <span
                  className={`ww-num text-[11px] leading-none ${
                    isActive
                      ? "text-background/80"
                      : isDone
                        ? "text-[color:var(--accent)]"
                        : "text-muted-foreground"
                  }`}
                >
                  {isDone ? "✓" : num}
                </span>
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium tracking-tight ${
                      isActive
                        ? "text-background"
                        : isDone
                          ? "text-foreground"
                          : "text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </p>
                  <p
                    className={`mt-0.5 text-[11px] leading-snug ${
                      isActive ? "text-background/70" : "text-muted-foreground"
                    }`}
                  >
                    {s.description}
                  </p>
                </div>
              </div>
            );

            return (
              <li key={s.key} aria-current={isActive ? "step" : undefined}>
                {canJump ? <Link href={s.href}>{inner}</Link> : inner}
              </li>
            );
          })}
        </ol>
      </div>

      {(datasetId || horizon || location) && (
        <div className="mt-8 hidden border-t border-foreground/15 pt-4 md:block">
          <p className="ww-label mb-3">§ Parameters</p>
          <dl className="space-y-2 text-[11px]">
            {horizon && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="ww-label text-muted-foreground">Horizon</dt>
                <dd className="ww-num capitalize">{horizon}</dd>
              </div>
            )}
            {location && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="ww-label text-muted-foreground">Coords</dt>
                <dd className="ww-num max-w-[130px] truncate text-right">{location}</dd>
              </div>
            )}
            {datasetId && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="ww-label text-muted-foreground">Dataset</dt>
                <dd className="ww-num max-w-[130px] truncate text-right">{datasetId.slice(0, 8)}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </nav>
  );
}
