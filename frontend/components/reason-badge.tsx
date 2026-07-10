export function ReasonBadge({ reason, live }: { reason: string; live: boolean }) {
  if (!live) {
    return (
      <span className="flex max-w-full items-start gap-2 border-l-2 border-dashed border-muted-foreground/40 pl-2 text-left text-xs italic leading-snug text-muted-foreground">
        {reason}
      </span>
    );
  }
  return (
    <span className="flex max-w-full items-start gap-2 border-l-2 border-accent pl-2 text-left text-sm font-medium leading-snug">
      <span className="ww-label text-accent">AI</span>
      <span className="text-foreground">{reason}</span>
    </span>
  );
}
