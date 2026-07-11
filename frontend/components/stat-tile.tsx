export function StatTile({
  label,
  value,
  hint,
  kicker,
  accent = false,
}: {
  /** Small-caps header at the top of the tile. */
  label: string;
  /** The big number/string in the middle. */
  value: string;
  /** One short line under the value in plain English. */
  hint?: string;
  /** Optional italic sub-label between value and hint, e.g. "vs. naive baseline". */
  kicker?: string;
  /** Highlight tile with the accent border color, e.g. for the "money saved" card. */
  accent?: boolean;
}) {
  return (
    <div
      className={`border bg-card ${
        accent
          ? "border-l-4 border-l-accent border-foreground/20"
          : "border-foreground/20"
      }`}
    >
      <div className="flex items-baseline justify-between border-b border-dashed border-foreground/20 px-4 py-2">
        <p className={`ww-label ${accent ? "text-accent" : ""}`}>{label}</p>
        <p className="ww-num text-[10px] text-muted-foreground">metric</p>
      </div>
      <div className="px-4 py-5">
        <p className="ww-num text-4xl font-semibold leading-none tracking-tight">
          {value}
        </p>
        {kicker ? (
          <p className="mt-1 text-[11px] italic text-muted-foreground">
            {kicker}
          </p>
        ) : null}
        {hint ? (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
