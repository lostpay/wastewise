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
    <div className="space-y-6">
      <Link
        href="/setup"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
      >
        <span aria-hidden>&larr;</span> Back to Setup
      </Link>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Step 2
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Predictive Forecast
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Per-item demand for the next {horizon}. The base model predicts sales
          from your history; an LLM then nudges each quantity up or down for
          weather and public holidays.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : loading || !forecast ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <>
          <StatTile
            label="Forecast accuracy gain vs. simple seasonal baseline"
            value={`${Math.round(forecast.baseline_delta * 100)}%`}
            hint="Lower mean absolute error on a 7-day holdout vs. a naive same-weekday baseline. Higher is better."
          />
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4">
            <ForecastChart items={forecast.items} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              <span>Item</span>
              <span className="flex items-center gap-4">
                <span className="w-24 text-right">Model prediction</span>
                <span className="w-24 text-right">Recommended</span>
                <span className="w-20 text-right">Change</span>
                <span className="hidden w-64 text-right sm:block">Why</span>
              </span>
            </div>
            <ul className="space-y-2">
              {forecast.items.map((it) => {
                const delta = it.adjusted_qty - it.forecast;
                const deltaPct = it.forecast ? (delta / it.forecast) * 100 : 0;
                const sign = delta > 0 ? "+" : "";
                const deltaColor =
                  delta > 0 ? "text-emerald-700" : delta < 0 ? "text-rose-700" : "text-zinc-500";
                return (
                  <li
                    key={it.item}
                    className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200/80 bg-white p-3 transition-colors hover:border-zinc-300"
                  >
                    <span className="font-medium capitalize text-zinc-900">
                      {it.item}
                    </span>
                    <span className="flex items-center gap-4">
                      <span className="w-24 text-right text-sm text-zinc-500">
                        {it.forecast.toFixed(1)}
                      </span>
                      <span className="w-24 text-right text-sm font-semibold text-zinc-900">
                        {it.adjusted_qty.toFixed(1)}
                      </span>
                      <span className={`w-20 text-right text-xs font-medium ${deltaColor}`}>
                        {sign}
                        {delta.toFixed(1)}
                        <span className="ml-1 text-[10px] font-normal opacity-70">
                          ({sign}
                          {deltaPct.toFixed(0)}%)
                        </span>
                      </span>
                      <span className="hidden w-64 justify-end sm:flex">
                        <ReasonBadge reason={it.reason} />
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <Button
            onClick={() => router.push("/sourcing")}
            className="bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Next: Sourcing &rarr;
          </Button>
        </>
      )}
    </div>
  );
}
