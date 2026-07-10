interface RedirectNoticeProps {
  target: string;
  reason: string;
}

export function RedirectNotice({ target, reason }: RedirectNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border border-foreground/25 bg-card p-6"
    >
      <p className="ww-label">§ Redirect</p>
      <div className="ww-rule mt-2 text-foreground/40" />
      <p className="mt-3 text-sm font-medium">{reason}</p>
      <p className="ww-num mt-1 text-[11px] text-muted-foreground">
        &rarr; sending you to {target}...
      </p>
    </div>
  );
}
