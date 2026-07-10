"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { runRationale } from "@/lib/api";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function OrderPage() {
  const router = useRouter();
  const { forecast, sourcing, rationale, hydrated, set } = useWizard();
  const [approved, setApproved] = useState(false);
  const [rationaleLoading, setRationaleLoading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!sourcing) router.push("/sourcing");
  }, [hydrated, sourcing, router]);

  useEffect(() => {
    // Rationale is a purely additive synthesis card -- never gate Approve/
    // Download on it, so a slow or failed call never blocks the page.
    if (!hydrated || !forecast || !sourcing) return;
    if (rationale || started.current) return;
    started.current = true;
    setRationaleLoading(true);
    runRationale(forecast.items, sourcing.lines, sourcing.savings, sourcing.total)
      .then((res) => set({ rationale: res }))
      .catch(() => {
        // Non-blocking: leave `rationale` null and simply don't render the
        // card's content. No inline error state -- this call never gates
        // Approve/Download per the design spec.
      })
      .finally(() => setRationaleLoading(false));
  }, [hydrated, forecast, sourcing, rationale, set]);

  if (!hydrated) return null;
  if (!sourcing)
    return <RedirectNotice target="Sourcing" reason="Pick suppliers before reviewing the purchase order." />;

  function download() {
    if (!sourcing) return;
    const blob = new Blob([poToCsv(sourcing.lines, sourcing.total)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase-order.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function round2(n: number) {
    return Math.round(n * 100) / 100;
  }

  function updateQty(index: number, qty: number) {
    if (!sourcing) return;
    const lines = sourcing.lines.map((l, i) =>
      i === index ? { ...l, qty, line_total: round2(l.unit_price * qty) } : l,
    );
    const total = round2(lines.reduce((s, l) => s + l.line_total, 0));
    set({ sourcing: { ...sourcing, lines, total } });
    setApproved(false);
  }

  return (
    <div className="space-y-8">
      <Link
        href="/sourcing"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to sourcing
      </Link>

      <div>
        <p className="ww-label text-accent">§ IV &mdash; Order</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Purchase Order
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review the draft, approve, and download the CSV for your supplier.
        </p>
      </div>

      <div>
        <p className="ww-label mb-2">Purchasing rationale</p>
        <div className="border border-foreground/20 bg-card px-4 py-4">
          {rationaleLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : rationale ? (
            <div className="space-y-2">
              <span
                className={`ww-label ${rationale.live ? "text-accent" : "text-muted-foreground"}`}
              >
                {rationale.live ? "AI synthesis" : "Synthesis unavailable"}
              </span>
              <p className="text-sm leading-relaxed text-foreground">{rationale.paragraph}</p>
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">Rationale unavailable.</p>
          )}
        </div>
      </div>

      <div>
        <p className="ww-label mb-2">Tbl. 3 — Purchase order draft</p>
        <div className="border border-foreground/20 bg-card">
          <POTable lines={sourcing.lines} total={sourcing.total} onQtyChange={updateQty} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-foreground/20 pt-4">
        <Button
          onClick={() => setApproved(true)}
          disabled={approved}
          className={
            approved
              ? "bg-accent text-accent-foreground"
              : "bg-accent text-accent-foreground hover:bg-accent/85"
          }
        >
          {approved ? "Approved ✓" : "Approve"}
        </Button>
        <Button
          variant="secondary"
          onClick={download}
          className="border border-foreground/25 bg-transparent hover:bg-foreground/5"
        >
          Download CSV
        </Button>
      </div>
    </div>
  );
}
