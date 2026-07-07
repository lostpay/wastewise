"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";

export default function OrderPage() {
  const router = useRouter();
  const { sourcing, hydrated } = useWizard();
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!sourcing) router.push("/sourcing");
  }, [hydrated, sourcing, router]);

  if (!hydrated) return null;
  if (!sourcing) return null;

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
    <div className="space-y-6">
      <Link
        href="/sourcing"
        className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900"
      >
        <span aria-hidden>&larr;</span> Back to Sourcing
      </Link>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Step 4
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Purchase Order
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Review the draft, approve, and download the CSV for your supplier.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white">
        <POTable lines={sourcing.lines} total={sourcing.total} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => setApproved(true)}
          disabled={approved}
          className={
            approved
              ? "bg-emerald-600 text-white"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }
        >
          {approved ? "Approved ✓" : "Approve"}
        </Button>
        <Button
          variant="secondary"
          onClick={download}
          className="border border-zinc-200"
        >
          Download CSV
        </Button>
      </div>
    </div>
  );
}
