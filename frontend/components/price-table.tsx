import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { POLine } from "@/lib/types";

function SupplierCell({ supplier }: { supplier: string }) {
  const isFallback = supplier === "Market";
  return (
    <div className="flex flex-col gap-0.5">
      <Badge
        variant={isFallback ? "outline" : "secondary"}
        className={
          isFallback
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }
      >
        {isFallback ? "No live offer" : supplier}
      </Badge>
      <span className="text-[11px] text-muted-foreground">
        {isFallback ? "US retail avg (BLS)" : "Local retail"}
      </span>
    </div>
  );
}

function PriceCell({ supplier, unitPrice }: { supplier: string; unitPrice: number }) {
  const isFallback = supplier === "Market";
  if (unitPrice === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span>${unitPrice.toFixed(2)}</span>
      {isFallback ? (
        <span className="text-[11px] text-muted-foreground">benchmark</span>
      ) : null}
    </div>
  );
}

function noteText(line: POLine): string {
  if (line.unit_price === 0) return "No pricing available for this item.";
  if (line.supplier === "Market") return "No supplier offer — showing BLS national average.";
  if (line.note === "At or above market benchmark.") return "Priced at or above US retail average.";
  return line.note;
}

export function PriceTable({ lines }: { lines: POLine[] }) {
  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.item}>
              <TableCell className="font-medium capitalize">{l.item}</TableCell>
              <TableCell>
                <SupplierCell supplier={l.supplier} />
              </TableCell>
              <TableCell className="text-right">
                <PriceCell supplier={l.supplier} unitPrice={l.unit_price} />
              </TableCell>
              <TableCell className="text-muted-foreground">{noteText(l)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-zinc-200/80 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-zinc-700">Kroger</span> rows are live nearest-store retail prices.
        <span className="ml-2 font-medium text-zinc-700">No live offer</span> means Kroger didn&apos;t
        stock the item — we fall back to the US retail average from the Bureau of Labor Statistics
        (via FRED) as a reference benchmark.
      </p>
    </div>
  );
}
