"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runSourcing } from "@/lib/api";
import { Stepper } from "@/components/stepper";
import { PriceTable } from "@/components/price-table";
import { StatTile } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function SourcingPage() {
  const router = useRouter();
  const { forecast, location, sourcing, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!forecast) {
      router.push("/forecast");
      return;
    }
    if (sourcing || started.current) return;
    started.current = true;
    setLoading(true);
    const items = forecast.items.map((it) => ({ item: it.item, qty: it.adjusted_qty }));
    runSourcing(items, location)
      .then((res) => set({ sourcing: res }))
      .finally(() => setLoading(false));
  }, [forecast, location, sourcing, router, set]);

  if (!forecast) return null;

  return (
    <>
      <Stepper current={2} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Sourcing</h2>
        {loading || !sourcing ? (
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
