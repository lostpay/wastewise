interface RedirectNoticeProps {
  target: string;
  reason: string;
}

export function RedirectNotice({ target, reason }: RedirectNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-zinc-200 bg-white p-6 text-center"
    >
      <p className="text-sm font-medium text-zinc-900">{reason}</p>
      <p className="mt-1 text-xs text-zinc-500">Redirecting to {target}…</p>
    </div>
  );
}
