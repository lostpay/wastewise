"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runForecast, ApiError } from "@/lib/api";
import { Stepper } from "@/components/stepper";
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
    <>
      <Stepper current={1} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Forecast &amp; adjustments</h2>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : loading || !forecast ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <>
            <StatTile label="Model improvement over baseline" value={`${Math.round(forecast.baseline_delta * 100)}%`} />
            <ForecastChart items={forecast.items} />
            <ul className="space-y-3">
              {forecast.items.map((it) => (
                <li key={it.item} className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <span className="font-medium capitalize">{it.item}</span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {it.forecast} → <span className="font-semibold text-foreground">{it.adjusted_qty}</span>
                    </span>
                  </div>
                  <ReasonBadge reason={it.reason} />
                </li>
              ))}
            </ul>
            <Button onClick={() => router.push("/sourcing")}>Next: Sourcing</Button>
          </>
        )}
      </main>
    </>
  );
}
