"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runSourcing, ApiError } from "@/lib/api";
import { PriceTable } from "@/components/price-table";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function SourcingPage() {
  const router = useRouter();
  const { forecast, location, sourcing, hydrated, set, datasetId, currency } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Idempotency latch keyed on the actual inputs to the fetch. See the same
  // pattern in forecast/page.tsx for why we key rather than reset a boolean
  // ref (avoids StrictMode dev double-invoke duplicating the network call).
  const firedFor = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hydrated) return;
    if (!forecast) {
      router.push("/forecast");
      return;
    }
    if (sourcing) return;
    // Forecast identity is part of the key: a new forecast object (e.g. from
    // a horizon change on setup) is a different input set and should re-run.
    const forecastKey = forecast.items.map((it) => `${it.item}:${it.adjusted_qty}`).join(",");
    const key = `${datasetId ?? ""}|${location}|${currency}|${forecastKey}`;
    if (firedFor.current.has(key)) return;
    firedFor.current.add(key);
    setLoading(true);
    setError(null);
    const items = forecast.items.map((it) => ({ item: it.item, qty: it.adjusted_qty }));
    runSourcing(items, location, datasetId, currency)
      .then((res) => set({ sourcing: res }))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."))
      .finally(() => setLoading(false));
  }, [hydrated, forecast, location, sourcing, router, set, datasetId, currency]);

  if (hydrated && !forecast)
    return <RedirectNotice target="Forecast" reason="Run a forecast before sourcing suppliers." />;

  return (
    <div className="space-y-8">
      <Link
        href="/forecast"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to forecast
      </Link>

      <div>
        <p className="ww-label text-accent">§ III &mdash; Sourcing</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Smart Sourcing
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Live Kroger retail prices for each item, benchmarked against the
          US retail average from the Bureau of Labor Statistics (via FRED).
        </p>
      </div>

      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : loading || !sourcing ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <StatTile
            label="Estimated savings vs. US retail average"
            value={`$${sourcing.savings.toFixed(2)}`}
            hint="Sum of (BLS benchmark − Kroger price) × qty for items where Kroger beats the benchmark. Items without a real US benchmark (e.g. Paneer, Mutton) are shown but not counted here."
          />
          <div>
            <p className="ww-label mb-2">Tbl. 2 — Supplier price detail</p>
            <div className="border border-foreground/20 bg-card">
              <PriceTable lines={sourcing.lines} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => router.push("/order")}
              className="bg-foreground text-background hover:bg-foreground/80"
            >
              Continue to purchase order &rarr;
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
