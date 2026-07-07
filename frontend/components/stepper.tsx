const STEPS = ["Setup", "Forecast", "Sourcing", "Order"];

export function Stepper({ current }: { current: number }) {
  return (
    <nav aria-label="Progress" className="flex items-center gap-2 border-b px-6 py-4">
      {STEPS.map((label, i) => (
        <div
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={`flex items-center gap-2 text-sm ${i === current ? "font-semibold text-foreground" : "text-muted-foreground"}`}
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${i <= current ? "border-foreground" : "border-muted"}`}>
            {i + 1}
          </span>
          <span>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-2 text-muted-foreground">→</span>}
        </div>
      ))}
    </nav>
  );
}
