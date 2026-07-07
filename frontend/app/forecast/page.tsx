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

  if (hydrated && !datasetId) return null;

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
          Weather- and holiday-adjusted demand for the next {horizon}.
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
            label="Model improvement over baseline"
            value={`${Math.round(forecast.baseline_delta * 100)}%`}
          />
          <div className="rounded-xl border border-zinc-200/80 bg-white p-4">
            <ForecastChart items={forecast.items} />
          </div>
          <ul className="space-y-2">
            {forecast.items.map((it) => (
              <li
                key={it.item}
                className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200/80 bg-white p-3 transition-colors hover:border-zinc-300"
              >
                <div>
                  <span className="font-medium capitalize text-zinc-900">
                    {it.item}
                  </span>
                  <span className="ml-2 text-sm text-zinc-500">
                    {it.forecast} &rarr;{" "}
                    <span className="font-semibold text-zinc-900">
                      {it.adjusted_qty}
                    </span>
                  </span>
                </div>
                <ReasonBadge reason={it.reason} />
              </li>
            ))}
          </ul>
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
