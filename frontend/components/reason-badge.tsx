const NO_ADJUSTMENT = "No adjustment applied.";

export function ReasonBadge({ reason }: { reason: string }) {
  const isFallback = reason.trim() === NO_ADJUSTMENT;
  if (isFallback) {
    return (
      <span className="text-right text-[11px] italic text-muted-foreground">
        no weather / holiday change
      </span>
    );
  }
  return (
    <span className="flex max-w-full items-start gap-2 border-l-2 border-accent pl-2 text-left text-[11px] leading-snug">
      <span className="ww-label text-accent">AI</span>
      <span className="text-foreground">{reason}</span>
    </span>
  );
}
