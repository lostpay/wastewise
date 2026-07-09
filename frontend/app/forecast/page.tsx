"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runForecast, ApiError } from "@/lib/api";
import { ForecastChart } from "@/components/forecast-chart";
import { StatTile } from "@/components/stat-tile";
import { ReasonBadge } from "@/components/reason-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function ForecastPage() {
  const router = useRouter();
  const { datasetId, horizon, location, forecast, hydrated, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!datasetId) {
      router.push("/setup");
      return;
    }
    if (forecast || started.current) return;
    started.current = true;
    setLoading(true);
    setError(null);
    runForecast(datasetId, horizon, location)
      .then((res) => set({ forecast: res }))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."))
      .finally(() => setLoading(false));
  }, [hydrated, datasetId, horizon, location, forecast, router, set]);

  if (hydrated && !datasetId)
    return <RedirectNotice target="Setup" reason="Upload a sales CSV to start forecasting." />;

  return (
    <div className="space-y-8">
      <Link
        href="/setup"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to setup
      </Link>

      <div>
        <p className="ww-label text-[color:var(--accent)]">§ II &mdash; Forecast</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Predictive Forecast
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Per-item demand for the next {horizon}. The base model predicts sales
          from your history; an LLM then nudges each quantity up or down for
          weather and public holidays.
        </p>
      </div>

      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : loading || !forecast ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <StatTile
            label="Forecast accuracy gain vs. simple seasonal baseline"
            value={`${Math.round(forecast.baseline_delta * 100)}%`}
            hint="Lower mean absolute error on a 7-day holdout vs. a naive same-weekday baseline. Higher is better."
          />
          <div className="border border-foreground/20 bg-card">
            <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2">
              <p className="ww-label">Fig. 1 — Per-item quantities</p>
              <div className="ww-num flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-[color:var(--chart-3)]" /> Model
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-[color:var(--foreground)]" /> Recommended
                </span>
              </div>
            </div>
            <div className="p-4">
              <ForecastChart items={forecast.items} />
            </div>
          </div>
          <div>
            <p className="ww-label mb-2">Tbl. 1 — Per-item detail</p>
            <div className="border border-foreground/20">
              <div className="grid grid-cols-[1fr_5rem_5rem_5rem_1fr] items-center gap-4 border-b-2 border-foreground/60 bg-[color:var(--muted)] px-3 py-2">
                <span className="ww-label">Item</span>
                <span className="ww-label text-right">Model</span>
                <span className="ww-label text-right">Rec.</span>
                <span className="ww-label text-right">Δ</span>
                <span className="ww-label hidden text-right sm:block">Note</span>
              </div>
              <ul>
                {forecast.items.map((it, idx) => {
                  const delta = it.adjusted_qty - it.forecast;
                  const deltaPct = it.forecast ? (delta / it.forecast) * 100 : 0;
                  const sign = delta > 0 ? "+" : "";
                  const deltaColor =
                    delta > 0
                      ? "text-[color:var(--accent)]"
                      : delta < 0
                        ? "text-destructive"
                        : "text-muted-foreground";
                  return (
                    <li
                      key={it.item}
                      className={`grid grid-cols-[1fr_5rem_5rem_5rem_1fr] items-center gap-4 px-3 py-3 ${
                        idx > 0 ? "border-t border-dashed border-foreground/15" : ""
                      }`}
                    >
                      <span className="text-sm font-medium capitalize">{it.item}</span>
                      <span className="ww-num text-right text-sm text-muted-foreground">
                        {it.forecast.toFixed(1)}
                      </span>
                      <span className="ww-num text-right text-sm font-semibold">
                        {it.adjusted_qty.toFixed(1)}
                      </span>
                      <span className={`ww-num text-right text-xs ${deltaColor}`}>
                        {sign}
                        {delta.toFixed(1)}
                        <span className="ml-1 opacity-70">
                          ({sign}
                          {deltaPct.toFixed(0)}%)
                        </span>
                      </span>
                      <span className="hidden justify-end sm:flex">
                        <ReasonBadge reason={it.reason} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => router.push("/sourcing")}
              className="bg-foreground text-background hover:bg-foreground/80"
            >
              Continue to sourcing &rarr;
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
