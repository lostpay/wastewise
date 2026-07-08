"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { uploadCsv, ApiError } from "@/lib/api";
import { setDemoMode } from "@/lib/demo";
import type { Horizon, UploadResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupPage() {
  const router = useRouter();
  const { location, horizon, set } = useWizard();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function advance(res: UploadResponse) {
    // Clear any forecast/sourcing from a prior dataset. The forecast and
    // sourcing pages skip recomputation when those values are already present,
    // so a new upload must reset them or the wizard shows the previous run's data.
    set({ datasetId: res.dataset_id, summary: res.summary, forecast: null, sourcing: null });
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
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
          Step 1
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">
          Dataset Setup
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Upload your sales CSV, or click{" "}
          <span className="font-medium text-zinc-700">Use demo dataset</span> to
          walk the full flow with bundled sample data.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="csv" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Sales CSV
        </Label>
        <Input
          id="csv"
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="border-zinc-200"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="loc" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Location (lat,lon)
          </Label>
          <Input
            id="loc"
            value={location}
            onChange={(e) => set({ location: e.target.value })}
            className="border-zinc-200 font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="horizon" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Horizon
          </Label>
          <select
            id="horizon"
            className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            value={horizon}
            onChange={(e) => set({ horizon: e.target.value as Horizon })}
          >
            <option value="day">Next day</option>
            <option value="week">Next week</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <Button
          onClick={onUpload}
          disabled={!file || loading}
          className="bg-zinc-900 text-white hover:bg-zinc-700"
        >
          {loading ? "Uploading..." : "Upload"}
        </Button>
        <Button
          variant="secondary"
          onClick={onDemo}
          disabled={loading}
          className="border border-zinc-200"
        >
          Use demo dataset
        </Button>
      </div>
    </div>
  );
}
