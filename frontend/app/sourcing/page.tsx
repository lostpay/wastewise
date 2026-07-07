"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runSourcing, ApiError } from "@/lib/api";
import { Stepper } from "@/components/stepper";
import { PriceTable } from "@/components/price-table";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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

  if (hydrated && !forecast) return null;

  return (
    <>
      <Stepper current={2} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Sourcing</h2>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : loading || !sourcing ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <StatTile label="Estimated savings vs. market" value={`$${sourcing.savings.toFixed(2)}`} />
            <PriceTable lines={sourcing.lines} />
            <Button onClick={() => router.push("/order")}>Next: Purchase Order</Button>
          </>
        )}
      </main>
    </>
  );
}
