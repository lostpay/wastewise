"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { uploadCsv, ApiError } from "@/lib/api";
import { setDemoMode, clearDemoServed } from "@/lib/demo";
import type { Horizon, UploadResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CsvDropzone } from "@/components/ui/csv-dropzone";
import { Label } from "@/components/ui/label";

const LocationPicker = dynamic(
  () => import("@/components/ui/location-picker").then((m) => m.LocationPicker),
  { ssr: false },
);

export default function SetupPage() {
  const router = useRouter();
  const { location, horizon, datasetId, hydrated, set } = useWizard();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      set({ datasetId: null, summary: null, forecast: null, sourcing: null, rationale: null });
    }
  }, [hydrated, datasetId, set]);

  function advance(res: UploadResponse) {
    // Clear any forecast/sourcing from a prior dataset. The forecast and
    // sourcing pages skip recomputation when those values are already present,
    // so a new upload must reset them or the wizard shows the previous run's data.
    set({ datasetId: res.dataset_id, summary: res.summary, forecast: null, sourcing: null, rationale: null });
    router.push("/forecast");
  }

  async function onUpload() {
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      advance(await uploadCsv(file));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onDemo() {
    setDemoMode(true);
    setError(null);
    setLoading(true);
    try {
      advance(await uploadCsv(new File([""], "demo.csv", { type: "text/csv" })));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
          <span className="font-medium text-foreground">Use demo dataset</span> to
          walk the full flow with bundled sample data.
        </p>
      </div>

      <div>
        <p className="ww-label mb-2">1.1 &mdash; Sales history</p>
        <CsvDropzone value={file} onChange={setFile} disabled={loading} />
      </div>

      <div>
        <p className="ww-label mb-2">1.2 &mdash; Location</p>
        <LocationPicker value={location} onChange={(v) => set({ location: v })} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="horizon" className="ww-label">
          1.3 &mdash; Horizon
        </Label>
        <select
          id="horizon"
          className="ww-num h-9 w-full border border-foreground/25 bg-card px-3 text-sm focus:border-accent focus:outline-none"
          value={horizon}
          onChange={(e) => set({ horizon: e.target.value as Horizon })}
        >
          <option value="day">Next day</option>
          <option value="week">Next week</option>
        </select>
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
