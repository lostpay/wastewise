import type { POLine } from "@/lib/types";

export function POTable({
  lines,
  total,
  onQtyChange,
}: {
  lines: POLine[];
  total: number;
  onQtyChange?: (index: number, qty: number) => void;
}) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b-2 border-foreground/60 bg-muted">
          <th className="ww-label px-4 py-2 text-left">Item</th>
          <th className="ww-label px-4 py-2 text-right">Qty</th>
          <th className="ww-label px-4 py-2 text-left">Supplier</th>
          <th className="ww-label px-4 py-2 text-right">Unit price</th>
          <th className="ww-label px-4 py-2 text-right">Line total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, idx) => (
          <tr
            key={l.item}
            className={idx > 0 ? "border-t border-dashed border-foreground/15" : ""}
          >
            <td className="px-4 py-3 text-sm font-medium capitalize">{l.item}</td>
            <td className="ww-num px-4 py-3 text-right text-sm">
              {onQtyChange ? (
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={l.qty}
                  aria-label={`Quantity for ${l.item}`}
                  onChange={(e) => onQtyChange(idx, Math.max(0, Number(e.target.value) || 0))}
                  className="ww-num w-20 border border-foreground/25 bg-card px-2 py-1 text-right text-sm focus:border-accent focus:outline-none"
                />
              ) : (
                l.qty
              )}
            </td>
            <td className="px-4 py-3 text-sm">
              {l.supplier === "Market" ? (
                <span className="italic text-muted-foreground">benchmark</span>
              ) : (
                l.supplier
              )}
            </td>
            <td className="ww-num px-4 py-3 text-right text-sm">
              ${l.unit_price.toFixed(2)}
              {l.unit ? <span className="text-muted-foreground"> / {l.unit}</span> : null}
            </td>
            <td className="ww-num px-4 py-3 text-right text-sm">
              ${l.line_total.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-double border-foreground/60 bg-muted">
          <td colSpan={4} className="ww-label px-4 py-3">
            Grand total
          </td>
          <td className="ww-num px-4 py-3 text-right text-base font-semibold">
            ${total.toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
