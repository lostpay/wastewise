import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { POLine } from "@/lib/types";

export function POTable({ lines, total }: { lines: POLine[]; total: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Supplier</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead className="text-right">Line total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.item}>
            <TableCell className="font-medium capitalize">{l.item}</TableCell>
            <TableCell className="text-right">{l.qty}</TableCell>
            <TableCell>{l.supplier}</TableCell>
            <TableCell className="text-right">${l.unit_price.toFixed(2)}</TableCell>
            <TableCell className="text-right">${l.line_total.toFixed(2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4}>Grand total</TableCell>
          <TableCell className="text-right font-bold">${total.toFixed(2)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
