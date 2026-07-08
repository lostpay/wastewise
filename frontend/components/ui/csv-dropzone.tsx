"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { cn } from "@/lib/utils";

interface CsvDropzoneProps {
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

const REQUIRED_COLUMNS = ["date", "item", "quantity"] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const SAMPLE_CSV =
  "date,item,quantity\n2026-04-01,cabbage,20\n2026-04-01,pork,15\n2026-04-01,chicken,25\n2026-04-02,cabbage,22\n";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function inspectCsv(file: File): Promise<{ ok: true; columns: string[]; rows: number } | { ok: false; error: string }> {
  if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
    return { ok: false, error: "File must be a .csv" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is ${formatBytes(file.size)} — max is ${formatBytes(MAX_BYTES)}` };
  }
  const text = await file.text();
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const columns = firstLine.split(",").map((c) => c.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    return { ok: false, error: `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` };
  }
  const rows = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length - 1;
  return { ok: true, columns, rows: Math.max(rows, 0) };
}

export function CsvDropzone({ value, onChange, disabled }: CsvDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ columns: string[]; rows: number } | null>(null);

  const pick = useCallback(
    async (file: File | null) => {
      setError(null);
      setPreview(null);
      if (!file) {
        onChange(null);
        return;
      }
      const check = await inspectCsv(file);
      if (!check.ok) {
        setError(check.error);
        onChange(null);
        return;
      }
      setPreview({ columns: check.columns, rows: check.rows });
      onChange(file);
    },
    [onChange],
  );

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void pick(e.dataTransfer.files?.[0] ?? null);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function downloadSample(e: React.MouseEvent) {
    e.stopPropagation();
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wastewise-sample.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sales CSV</p>
        <button
          type="button"
          onClick={downloadSample}
          className="text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
        >
          Download sample
        </button>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-disabled={disabled}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging
            ? "border-emerald-500 bg-emerald-50"
            : value
            ? "border-emerald-300 bg-emerald-50/40"
            : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 hover:bg-zinc-100",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => void pick(e.target.files?.[0] ?? null)}
          aria-label="Sales CSV"
        />

        {value && preview ? (
          <div className="flex w-full items-center justify-between gap-3 text-left">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.5 3h9l4.5 4.5v13.5a1.5 1.5 0 01-1.5 1.5h-12A1.5 1.5 0 012 21V4.5A1.5 1.5 0 013.5 3h4" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{value.name}</p>
                <p className="text-xs text-zinc-500">
                  {formatBytes(value.size)} · {preview.rows.toLocaleString()} row{preview.rows === 1 ? "" : "s"} · {preview.columns.length} column{preview.columns.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
              </svg>
            </div>
            <p className="mt-3 text-sm text-zinc-700">
              <span className="font-medium">Drop your CSV here</span> or <span className="font-medium text-emerald-700">browse</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Required columns: <span className="font-mono">date, item, quantity</span> · up to 5 MB
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
