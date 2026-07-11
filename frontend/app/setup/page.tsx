"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { uploadCsv, ApiError } from "@/lib/api";
import {
  setDemoMode,
  clearDemoServed,
  DEMO_HISTORY,
  DEMO_UPLOAD,
} from "@/lib/demo";
import { parseSalesHistory } from "@/lib/csv";
import type { Currency, UploadResponse, HistoryPoint } from "@/lib/types";
import { CURRENCY_OPTIONS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CsvDropzone } from "@/components/ui/csv-dropzone";
import { Label } from "@/components/ui/label";
import { HorizonCalendar } from "@/components/ui/horizon-calendar";

const LocationPicker = dynamic(
  () => import("@/components/ui/location-picker").then((m) => m.LocationPicker),
  { ssr: false },
);

export default function SetupPage() {
  const router = useRouter();
  const { location, horizonDays, currency, datasetId, hydrated, set } =
    useWizard();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string>(
    DEMO_UPLOAD.summary.end_date,
  );
  const cleared = useRef(false);

  // Landing on Setup means "start over" — clear any dataset/forecast/sourcing
  // and any prior demo-mode flag so downstream guards (and the sidebar) refuse
  // to jump ahead until the user picks a CSV or clicks demo again. Runs once
  // per mount, after hydration, so a genuine advance() call isn't undone.
  useEffect(() => {
    if (!hydrated || cleared.current) return;
    cleared.current = true;
    if (datasetId) {
      setDemoMode(false);
      clearDemoServed();
      set({
        datasetId: null,
        summary: null,
        forecast: null,
        sourcing: null,
        rationale: null,
        history: null,
      });
    }
  }, [hydrated, datasetId, set]);

  // The forecast starts the day after the data ends, so the calendar anchor is
  // the CSV's last date. Parse the chosen file client-side to find it; with no
  // file (incl. the demo path) fall back to the demo dataset's known end date.
  useEffect(() => {
    if (!file) {
      startTransition(() => setLastDate(DEMO_UPLOAD.summary.end_date));
      return;
    }
    let cancelled = false;
    file
      .text()
      .then((text) => {
        if (cancelled) return;
        const dates = parseSalesHistory(text)
          .map((p) => p.date)
          .sort();
        startTransition(() => {
          setLastDate(
            dates.length
              ? dates[dates.length - 1]
              : DEMO_UPLOAD.summary.end_date,
          );
        });
      })
      .catch(() => {
        if (!cancelled) {
          startTransition(() => setLastDate(DEMO_UPLOAD.summary.end_date));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  function advance(res: UploadResponse, history: HistoryPoint[] | null) {
    // Clear any forecast/sourcing from a prior dataset. The forecast and
    // sourcing pages skip recomputation when those values are already present,
    // so a new upload must reset them or the wizard shows the previous run's data.
    set({
      datasetId: res.dataset_id,
      summary: res.summary,
      forecast: null,
      sourcing: null,
      rationale: null,
      history,
    });
    router.push("/forecast");
  }

  async function onUpload() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      advance(await uploadCsv(file), parseSalesHistory(text));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Upload failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function onDemo() {
    setDemoMode(true);
    setError(null);
    setLoading(true);
    try {
      advance(
        await uploadCsv(new File([""], "demo.csv", { type: "text/csv" })),
        DEMO_HISTORY,
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Upload failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const [ly, lm, ld] = lastDate.split("-").map(Number);
  const startISO = new Date(Date.UTC(ly, lm - 1, ld + 1))
    .toISOString()
    .slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <p className="ww-label text-accent">§ I &mdash; Setup</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Dataset Setup
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Upload your sales CSV, or click{" "}
          <span className="font-medium text-foreground">Use demo dataset</span>{" "}
          to walk the full flow with bundled sample data.
        </p>
      </div>

      <div>
        <p className="ww-label mb-2">1.1 &mdash; Sales history</p>
        <CsvDropzone value={file} onChange={setFile} disabled={loading} />
      </div>

      <div>
        <p className="ww-label mb-2">1.2 &mdash; Location</p>
        <LocationPicker
          value={location}
          onChange={(v) => set({ location: v })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="currency" className="ww-label">
          1.3 &mdash; Data currency
        </Label>
        <select
          id="currency"
          className="ww-num h-9 w-full border border-foreground/25 bg-card px-3 text-sm focus:border-accent focus:outline-none"
          value={currency}
          onChange={(e) => set({ currency: e.target.value as Currency })}
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Currency of the <span className="ww-num">price</span> column in your
          CSV. Non-USD values are converted to USD before comparison to Kroger
          and BLS/FRED benchmarks.
        </p>
      </div>

      <div className="space-y-2">
        <p className="ww-label">1.4 &mdash; Forecast horizon</p>
        <HorizonCalendar
          start={startISO}
          days={horizonDays}
          onChange={(d) => set({ horizonDays: d })}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Forecasts start the day after your data ends. Pick an end date up to
          14 days out &mdash; beyond that, weather forecasts aren&rsquo;t
          available.
        </p>
      </div>

      {error && (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3 border-t border-dashed border-foreground/20 pt-4">
        <Button
          onClick={onUpload}
          disabled={!file || loading}
          className="bg-foreground text-background hover:bg-foreground/80"
        >
          {loading ? "Uploading..." : "Upload & continue"}
        </Button>
        <Button
          variant="secondary"
          onClick={onDemo}
          disabled={loading}
          className="border border-foreground/25 bg-transparent hover:bg-foreground/5"
        >
          Use demo dataset
        </Button>
      </div>
    </div>
  );
}
