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
  const { forecast, location, sourcing, hydrated, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!forecast) {
      router.push("/forecast");
      return;
    }
    if (sourcing || started.current) return;
    started.current = true;
    setLoading(true);
    setError(null);
    const items = forecast.items.map((it) => ({ item: it.item, qty: it.adjusted_qty }));
    runSourcing(items, location)
      .then((res) => set({ sourcing: res }))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."))
      .finally(() => setLoading(false));
  }, [hydrated, forecast, location, sourcing, router, set]);

  if (hydrated && !forecast)
    return <RedirectNotice target="Forecast" reason="Run a forecast before sourcing suppliers." />;

  return (
    <div className="space-y-6">
      <Link
        href="/forecast"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
      >
        <span aria-hidden>&larr;</span> Back to Forecast
      </Link>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Step 3
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Smart Sourcing
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Live Kroger retail prices for each item, benchmarked against the
          US retail average from the Bureau of Labor Statistics (via FRED).
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : loading || !sourcing ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <StatTile
            label="Estimated savings vs. US retail average"
            value={`$${sourcing.savings.toFixed(2)}`}
            hint="Sum of (BLS benchmark − Kroger price) × qty for items where Kroger beats the benchmark."
          />
          <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white">
            <PriceTable lines={sourcing.lines} />
          </div>
          <Button
            onClick={() => router.push("/order")}
            className="bg-zinc-900 text-white hover:bg-zinc-700"
          >
            Next: Purchase Order &rarr;
          </Button>
        </>
      )}
    </div>
  );
}
