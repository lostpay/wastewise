"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { uploadCsv, ApiError } from "@/lib/api";
import { setDemoMode } from "@/lib/demo";
import type { Horizon, UploadResponse } from "@/lib/types";
import { Stepper } from "@/components/stepper";
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
    set({ datasetId: res.dataset_id, summary: res.summary });
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
    <>
      <Stepper current={0} />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h2 className="text-xl font-semibold">Set up your forecast</h2>
        <p className="text-sm text-muted-foreground">
          No backend configured? Click <span className="font-medium">Use demo dataset</span> to walk the full flow with sample data.
        </p>

        <div className="space-y-2">
          <Label htmlFor="csv">Sales CSV</Label>
          <Input id="csv" type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="loc">Location (lat,lon)</Label>
            <Input id="loc" value={location} onChange={(e) => set({ location: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="horizon">Horizon</Label>
            <select
              id="horizon"
              className="h-9 w-full rounded-md border px-3 text-sm"
              value={horizon}
              onChange={(e) => set({ horizon: e.target.value as Horizon })}
            >
              <option value="day">Next day</option>
              <option value="week">Next week</option>
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button onClick={onUpload} disabled={!file || loading}>Upload</Button>
          <Button variant="secondary" onClick={onDemo} disabled={loading}>Use demo dataset</Button>
        </div>
      </main>
    </>
  );
}
