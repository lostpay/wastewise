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
            isFallback ? "bg-muted-foreground" : "bg-[color:var(--accent)]"
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

function PriceCell({ supplier, unitPrice }: { supplier: string; unitPrice: number }) {
  const isFallback = supplier === "Market";
  if (unitPrice === 0) {
    return <span className="ww-num text-muted-foreground">&mdash;</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="ww-num text-sm">${unitPrice.toFixed(2)}</span>
      {isFallback ? (
        <span className="text-[10px] italic text-muted-foreground">benchmark</span>
      ) : null}
    </div>
  );
}

function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available.";
  if (line.supplier === "Market") return "Using BLS national average as reference.";
  if (line.note === "At or above market benchmark.") return "At or above US retail average.";
  return line.note;
}

export function PriceTable({ lines }: { lines: POLine[] }) {
  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-foreground/60 bg-[color:var(--muted)]">
            <th className="ww-label px-4 py-2 text-left">Item</th>
            <th className="ww-label px-4 py-2 text-left">Supplier</th>
            <th className="ww-label px-4 py-2 text-right">Unit price</th>
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
                <PriceCell supplier={l.supplier} unitPrice={l.unit_price} />
              </td>
              <td className="px-4 py-3 text-[11px] text-muted-foreground">{noteText(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-foreground/15 bg-[color:var(--muted)]/40 px-4 py-3">
        <p className="ww-label mb-1">§ Legend</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="ww-label text-foreground">Kroger</span> rows are live
          nearest-store retail prices via the Kroger Products API.
          <span className="ww-label ml-2 text-foreground">No live offer</span>{" "}
          means Kroger doesn&apos;t stock the item; we show the US retail
          average from the Bureau of Labor Statistics (via FRED) as a reference
          benchmark.
        </p>
      </div>
    </div>
  );
}
