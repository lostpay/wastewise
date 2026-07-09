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
    <div className="space-y-8">
      <Link
        href="/forecast"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to forecast
      </Link>

      <div>
        <p className="ww-label text-[color:var(--accent)]">§ III &mdash; Sourcing</p>
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
            hint="Sum of (BLS benchmark − Kroger price) × qty for items where Kroger beats the benchmark."
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
