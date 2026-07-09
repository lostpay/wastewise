export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-foreground/20 bg-card">
      <div className="flex items-baseline justify-between border-b border-dashed border-foreground/20 px-4 py-2">
        <p className="ww-label">{label}</p>
        <p className="ww-num text-[10px] text-muted-foreground">metric</p>
      </div>
      <div className="px-4 py-5">
        <p className="ww-num text-4xl font-semibold leading-none tracking-tight">
          {value}
        </p>
        {hint ? (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
