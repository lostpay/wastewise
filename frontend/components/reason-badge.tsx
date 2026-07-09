import { Badge } from "@/components/ui/badge";

const NO_ADJUSTMENT = "No adjustment applied.";

export function ReasonBadge({ reason }: { reason: string }) {
  const isFallback = reason.trim() === NO_ADJUSTMENT;
  if (isFallback) {
    return (
      <span className="text-right text-xs text-muted-foreground">
        Matches the model — no weather or holiday change.
      </span>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="whitespace-normal border-emerald-200 bg-emerald-50 text-left text-emerald-800"
    >
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        AI
      </span>
      {reason}
    </Badge>
  );
}
