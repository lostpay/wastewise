import type { POLine } from "@/lib/types";

function SupplierCell({ supplier }: { supplier: string }) {
  const isFallback = supplier === "Market";
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`ww-label inline-flex items-center gap-1.5 ${
          isFallback ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 ${
            isFallback ? "bg-muted-foreground" : "bg-accent"
          }`}
        />
        {isFallback ? "No live offer" : supplier}
      </span>
      <span className="text-[10px] italic text-muted-foreground">
        {isFallback ? "BLS national avg" : "Local retail"}
      </span>
    </div>
  );
}

function PriceCell({ line }: { line: POLine }) {
  const isFallback = line.supplier === "Market";
  if (line.unit_price === 0) {
    return <span className="ww-num text-muted-foreground">&mdash;</span>;
  }
  // Show the delta vs. US benchmark right under the unit price -- that's where
  // the reader's eye is when asking "is this a good deal?"
  const hasBenchmark = line.benchmark != null && line.benchmark > 0;
  const pct = hasBenchmark
    ? ((line.unit_price - line.benchmark!) / line.benchmark!) * 100
    : 0;
  const roundedPct = Math.round(Math.abs(pct));
  const isUnder = pct < 0;
  // Suppress a "+0% vs. avg" line: when the unit price *is* the benchmark
  // (e.g. a Market fallback row), the delta is noise. Fall through to the
  // "benchmark" hint instead.
  const showDelta = hasBenchmark && roundedPct > 0;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="ww-num text-sm">
        ${line.unit_price.toFixed(2)}
        {line.unit ? <span className="text-muted-foreground"> / {line.unit}</span> : null}
      </span>
      {showDelta ? (
        <span
          className={`ww-num text-[10px] ${
            isUnder ? "text-emerald-700" : line.flagged ? "text-amber-700" : "text-muted-foreground"
          }`}
        >
          {isUnder ? "−" : "+"}
          {roundedPct}% vs. avg
        </span>
      ) : isFallback ? (
        <span className="text-[10px] italic text-muted-foreground">benchmark</span>
      ) : null}
    </div>
  );
}

function BenchmarkCell({ line }: { line: POLine }) {
  if (line.benchmark == null) {
    return <span className="ww-num text-muted-foreground">&mdash;</span>;
  }
  return <span className="ww-num text-sm">${line.benchmark.toFixed(2)}</span>;
}

function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using the US retail average as reference.";
  return line.note;
}

function NoteCell({ line }: { line: POLine }) {
  const text = noteText(line);
  if (line.flagged) {
    return (
      <div className="flex flex-col gap-0.5 text-left">
        <span className="ww-label text-amber-700">AI flags this price</span>
        <span className="text-[11px] leading-snug text-foreground">{text}</span>
      </div>
    );
  }
  if (line.live) {
    return (
      <div className="flex flex-col gap-0.5 text-left">
        <span className="ww-label text-accent">AI picked this</span>
        <span className="text-[11px] leading-snug text-foreground">{text}</span>
      </div>
    );
  }
  return <span className="text-[11px] text-muted-foreground">{text}</span>;
}

export function PriceTable({ lines }: { lines: POLine[] }) {
  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-foreground/60 bg-muted">
            <th className="ww-label px-4 py-2 text-left">Item</th>
            <th className="ww-label px-4 py-2 text-left">Supplier</th>
            <th className="ww-label px-4 py-2 text-right">Unit price</th>
            <th className="ww-label px-4 py-2 text-right">US avg</th>
            <th className="ww-label px-4 py-2 text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, idx) => (
            <tr
              key={l.item}
              className={idx > 0 ? "border-t border-dashed border-foreground/15" : ""}
            >
              <td className="px-4 py-3 text-sm font-medium capitalize">{l.item}</td>
              <td className="px-4 py-3">
                <SupplierCell supplier={l.supplier} />
              </td>
              <td className="px-4 py-3 text-right">
                <PriceCell line={l} />
              </td>
              <td className="px-4 py-3 text-right">
                <BenchmarkCell line={l} />
              </td>
              <td className="px-4 py-3">
                <NoteCell line={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-foreground/15 bg-muted/40 px-4 py-3">
        <p className="ww-label mb-1">§ Legend</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="ww-label text-foreground">Kroger</span> rows are live
          nearest-store retail prices via the Kroger Products API.
          <span className="ww-label ml-2 text-foreground">No live offer</span>{" "}
          means Kroger doesn&apos;t stock the item; we show the US retail
          average from the Bureau of Labor Statistics (via FRED) as a reference
          benchmark.{" "}
          <span className="ww-label ml-2 text-foreground">US avg</span> is the
          BLS national average for the item, or &mdash; when no US benchmark
          exists (e.g. Paneer, Mutton).
        </p>
      </div>
    </div>
  );
}
