import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { POLine } from "@/lib/types";

export function PriceTable({ lines }: { lines: POLine[] }) {
  return (
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
            <TableCell>{l.supplier}</TableCell>
            <TableCell className="text-right">${l.unit_price.toFixed(2)}</TableCell>
            <TableCell className="text-muted-foreground">{l.note}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
