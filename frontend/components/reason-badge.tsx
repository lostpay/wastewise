import { Badge } from "@/components/ui/badge";

export function ReasonBadge({ reason }: { reason: string }) {
  return <Badge variant="secondary" className="whitespace-normal text-left">{reason}</Badge>;
}
