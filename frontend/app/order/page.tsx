"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { Stepper } from "@/components/stepper";
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
    <>
      <Stepper current={3} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Purchase order</h2>
        <POTable lines={sourcing.lines} total={sourcing.total} />
        <div className="flex items-center gap-3">
          <Button onClick={() => setApproved(true)} disabled={approved}>
            {approved ? "Approved ✓" : "Approve"}
          </Button>
          <Button variant="secondary" onClick={download}>Download CSV</Button>
        </div>
      </main>
    </>
  );
}
