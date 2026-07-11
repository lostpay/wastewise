"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { poToCsv } from "@/lib/csv";
import { runRationale, runWhatIf } from "@/lib/api";
import { POTable } from "@/components/po-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function OrderPage() {
  const router = useRouter();
  const { forecast, sourcing, rationale, hydrated, set } = useWizard();
  const [approved, setApproved] = useState(false);
  const [rationaleLoading, setRationaleLoading] = useState(false);
  const [whatIfMsg, setWhatIfMsg] = useState("");
  const [whatIfReply, setWhatIfReply] = useState<string | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const started = useRef(false);
  // Bumped every time the order changes in a way that invalidates the
  // in-flight (or not-yet-started) rationale fetch below. A fetch only
  // writes its result if the generation hasn't moved since it started --
  // otherwise it's stale (computed against pre-edit numbers) and must be
  // dropped silently rather than overwrite the already-null rationale.
  const rationaleGen = useRef(0);

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
    const gen = rationaleGen.current;
    setRationaleLoading(true);
    runRationale(forecast.items, sourcing.lines, sourcing.savings, sourcing.total)
      .then((res) => {
        // Drop late results if the order was edited (or another what-if
        // applied) while this request was in flight -- its figures can't
        // contradict the edited table.
        if (rationaleGen.current === gen) set({ rationale: res });
      })
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

  const flaggedCount = sourcing.lines.filter((l) => l.flagged).length;

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
    // A manual quantity override invalidates the AI rationale, which describes
    // the originally sourced order and cites its totals. Drop it (and suppress a
    // refetch) so its figures can't contradict the edited table. Bumping the
    // generation also retroactively voids any rationale fetch already in flight.
    started.current = true;
    rationaleGen.current += 1;
    set({ sourcing: { ...sourcing, lines, total }, rationale: null });
    setApproved(false);
  }

  async function askWhatIf(e: React.FormEvent) {
    e.preventDefault();
    if (!sourcing || !whatIfMsg.trim() || whatIfLoading) return;
    setWhatIfLoading(true);
    try {
      const res = await runWhatIf(whatIfMsg.trim(), sourcing.lines, sourcing.total);
      // The agent rewrote quantities -> the old rationale's figures are stale.
      started.current = true;
      rationaleGen.current += 1;
      set({ sourcing: { ...sourcing, lines: res.lines, total: res.total }, rationale: null });
      setWhatIfReply(res.reply);
      setApproved(false);
      setWhatIfMsg("");
    } catch {
      setWhatIfReply("Something went wrong — the order was not changed.");
    } finally {
      setWhatIfLoading(false);
    }
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
        <p className="ww-label mb-2">Negotiate the order</p>
        <div className="space-y-3 border border-foreground/20 bg-card px-4 py-4">
          <form onSubmit={askWhatIf} className="flex flex-wrap gap-2">
            <input
              type="text"
              value={whatIfMsg}
              onChange={(e) => setWhatIfMsg(e.target.value)}
              maxLength={500}
              placeholder='e.g. "keep it under $1,200" or "I already have 20 lbs of rice"'
              aria-label="Instruction for the purchasing copilot"
              className="min-w-0 flex-1 border border-foreground/25 bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <Button type="submit" disabled={whatIfLoading || !whatIfMsg.trim()}>
              {whatIfLoading ? "Thinking…" : "Ask AI"}
            </Button>
          </form>
          {whatIfReply ? (
            <div className="space-y-1">
              <span className="ww-label text-accent">AI copilot</span>
              <p className="text-sm leading-relaxed text-foreground">{whatIfReply}</p>
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              Tell the AI a budget, on-hand stock, or a scenario — it rewrites the
              quantities below and explains the trade-off.
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="ww-label mb-2">Tbl. 3 — Purchase order draft</p>
        <div className="border border-foreground/20 bg-card">
          <POTable
            lines={sourcing.lines}
            total={sourcing.total}
            onQtyChange={whatIfLoading ? undefined : updateQty}
          />
        </div>
      </div>

      {flaggedCount > 0 ? (
        <p className="border border-amber-700/40 bg-amber-700/10 px-3 py-2 text-sm text-amber-800">
          {flaggedCount} item{flaggedCount === 1 ? "" : "s"} flagged as priced above the US
          retail average
          {(sourcing.overpay ?? 0) > 0
            ? ` (est. $${(sourcing.overpay ?? 0).toFixed(2)} over benchmark)`
            : ""}
          . Review before approving.
        </p>
      ) : null}

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
