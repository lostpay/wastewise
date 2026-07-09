import type { POLine } from "@/lib/types";

export function POTable({ lines, total }: { lines: POLine[]; total: number }) {
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b-2 border-foreground/60 bg-[color:var(--muted)]">
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
            <td className="ww-num px-4 py-3 text-right text-sm">{l.qty}</td>
            <td className="px-4 py-3 text-sm">
              {l.supplier === "Market" ? (
                <span className="italic text-muted-foreground">benchmark</span>
              ) : (
                l.supplier
              )}
            </td>
            <td className="ww-num px-4 py-3 text-right text-sm">
              ${l.unit_price.toFixed(2)}
            </td>
            <td className="ww-num px-4 py-3 text-right text-sm">
              ${l.line_total.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-double border-foreground/60 bg-[color:var(--muted)]">
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
