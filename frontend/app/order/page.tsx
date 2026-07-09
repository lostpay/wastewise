"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";
import { RedirectNotice } from "@/components/redirect-notice";

export default function OrderPage() {
  const router = useRouter();
  const { sourcing, hydrated } = useWizard();
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!sourcing) router.push("/sourcing");
  }, [hydrated, sourcing, router]);

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

  return (
    <div className="space-y-8">
      <Link
        href="/sourcing"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to sourcing
      </Link>

      <div>
        <p className="ww-label text-[color:var(--accent)]">§ IV &mdash; Order</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Purchase Order
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Review the draft, approve, and download the CSV for your supplier.
        </p>
      </div>

      <div>
        <p className="ww-label mb-2">Tbl. 3 — Purchase order draft</p>
        <div className="border border-foreground/20 bg-card">
          <POTable lines={sourcing.lines} total={sourcing.total} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-foreground/20 pt-4">
        <Button
          onClick={() => setApproved(true)}
          disabled={approved}
          className={
            approved
              ? "bg-[color:var(--accent)] text-accent-foreground"
              : "bg-[color:var(--accent)] text-accent-foreground hover:bg-[color:var(--accent)]/85"
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
