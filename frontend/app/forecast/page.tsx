"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizard } from "@/lib/store";
import { runForecast, ApiError } from "@/lib/api";
import { ForecastChart } from "@/components/forecast-chart";
import { HistoryChart } from "@/components/history-chart";
import { StatTile } from "@/components/stat-tile";
import { ReasonBadge } from "@/components/reason-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RedirectNotice } from "@/components/redirect-notice";

export default function ForecastPage() {
  const router = useRouter();
  const { datasetId, horizonDays, location, forecast, history, summary, hydrated, set } = useWizard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Idempotency latch keyed on the actual inputs to the fetch. React 18
  // StrictMode dev double-invoke would otherwise fire runForecast twice on
  // the initial mount; the "already fired for THIS input" set only lets
  // the first call through. Uses a ref so identity is preserved across the
  // simulated remount that StrictMode does within the same logical mount.
  const firedFor = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hydrated) return;
    if (!datasetId) {
      router.push("/setup");
      return;
    }
    if (forecast) return;
    const key = `${datasetId}|${horizonDays}|${location}`;
    if (firedFor.current.has(key)) return;
    firedFor.current.add(key);
    setLoading(true);
    setError(null);
    runForecast(datasetId, horizonDays, location)
      .then((res) => set({ forecast: res }))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."))
      .finally(() => setLoading(false));
  }, [hydrated, datasetId, horizonDays, location, forecast, router, set]);

  if (hydrated && !datasetId)
    return <RedirectNotice target="Setup" reason="Upload a sales CSV to start forecasting." />;

  const rangeLabel = (() => {
    if (!summary) return `next ${horizonDays} day${horizonDays === 1 ? "" : "s"}`;
    const [y, m, d] = summary.end_date.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d + 1));
    const end = new Date(Date.UTC(y, m - 1, d + horizonDays));
    const f = (x: Date) => x.toISOString().slice(0, 10);
    return `next ${horizonDays} day${horizonDays === 1 ? "" : "s"} (${f(start)} – ${f(end)})`;
  })();

  return (
    <div className="space-y-8">
      <Link
        href="/setup"
        className="ww-num inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden>&larr;</span> back to setup
      </Link>

      <div>
        <p className="ww-label text-accent">§ II &mdash; Forecast</p>
        <h2 className="font-heading mt-1 text-3xl font-semibold">
          Predictive Forecast
        </h2>
        <div className="ww-rule mt-3 w-full text-foreground/40" />
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Per-item demand for the {rangeLabel}. The base model predicts sales
          from your history; an LLM then nudges each quantity up or down for
          weather and public holidays.
        </p>
      </div>

      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : loading || !forecast ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile
              label="Forecast accuracy"
              value={`${Math.round(forecast.baseline_delta * 100)}%`}
              kicker="more accurate than a rule-of-thumb forecast"
              hint="On your last 7 days of sales, our model was closer to what actually sold than a simple 'same day last week' guess."
            />
            {(forecast.waste_avoided_units ?? 0) > 0 ? (
              <StatTile
                label="Waste avoided"
                accent
                value={
                  forecast.waste_avoided_value != null
                    ? `$${forecast.waste_avoided_value.toFixed(2)}`
                    : `${(forecast.waste_avoided_units ?? 0).toFixed(0)} units`
                }
                kicker={
                  forecast.waste_avoided_value != null
                    ? "money you didn't waste on over-ordering"
                    : "units you didn't waste on over-ordering"
                }
                hint="Compared to that same simple guess, our model would have bought less food that wouldn't sell — over the same 7 days."
              />
            ) : null}
          </div>
          <details className="group border border-dashed border-foreground/20 bg-card px-4 py-3">
            <summary className="ww-label cursor-pointer text-muted-foreground group-hover:text-foreground">
              How is this measured?
            </summary>
            <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                We take the last 7 days of your uploaded sales history and hide
                them from the model. We train on everything before that, ask
                the model to predict those 7 hidden days, and compare its
                predictions to what actually sold.
              </p>
              <p>
                <span className="ww-label text-foreground">Baseline: </span>
                a naive rule &mdash; &ldquo;next Monday will sell what last
                Monday sold.&rdquo; This is what a restaurant would do
                without any modelling.
              </p>
              <p>
                <span className="ww-label text-foreground">Accuracy: </span>
                percent reduction in mean absolute error (average distance
                between predicted and actual, in units) vs. the naive rule.
              </p>
              <p>
                <span className="ww-label text-foreground">Waste avoided: </span>
                dollars (or units, if your CSV had no price column) of
                over-ordering the naive rule would have caused, minus the
                over-ordering our model would have caused &mdash; both with
                a 15% safety buffer applied.
              </p>
            </div>
          </details>
          <div className="border border-foreground/20 bg-card">
            <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2">
              <p className="ww-label">Fig. 1 — Per-item quantities</p>
              <div className="ww-num flex items-center gap-4 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-chart-3" /> Model
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 bg-foreground" /> Recommended
                </span>
              </div>
            </div>
            <div className="p-4">
              <ForecastChart items={forecast.items} />
            </div>
          </div>
          {history && history.length > 0 ? (
            <div className="border border-foreground/20 bg-card">
              <HistoryChart history={history} items={forecast.items} />
            </div>
          ) : null}
          <div>
            <p className="ww-label mb-2">Tbl. 1 — Per-item detail</p>
            <div className="border border-foreground/20">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-foreground/60 bg-muted">
                    <th className="ww-label px-4 py-2 text-left">Item</th>
                    <th className="ww-label px-4 py-2 text-right">Model</th>
                    <th className="ww-label px-4 py-2 text-right">Rec.</th>
                    <th className="ww-label px-4 py-2 text-right">Δ</th>
                    <th className="ww-label hidden px-4 py-2 text-right sm:table-cell">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.items.map((it, idx) => {
                    const delta = it.adjusted_qty - it.forecast;
                    const deltaPct = it.forecast ? (delta / it.forecast) * 100 : 0;
                    const sign = delta > 0 ? "+" : "";
                    // Down = saved-from-waste (green). Up = justified extra
                    // spend (amber). Zero = muted. Deliberately not "up=good"
                    // — this is a waste-reduction app, so shrinking a
                    // purchase is the product's success state.
                    const deltaColor =
                      delta < 0
                        ? "text-emerald-700"
                        : delta > 0
                          ? "text-amber-700"
                          : "text-muted-foreground";
                    return (
                      <Fragment key={it.item}>
                        <tr className={idx > 0 ? "border-t border-dashed border-foreground/15" : ""}>
                          <td className="px-4 py-3 text-sm font-medium capitalize">{it.item}</td>
                          <td className="ww-num px-4 py-3 text-right text-sm text-muted-foreground">
                            {it.forecast.toFixed(1)}
                          </td>
                          <td className="ww-num px-4 py-3 text-right text-sm font-semibold">
                            {it.adjusted_qty.toFixed(1)}
                          </td>
                          <td className={`ww-num px-4 py-3 text-right text-xs ${deltaColor}`}>
                            {sign}
                            {delta.toFixed(1)}
                            <span className="ml-1 opacity-70">
                              ({sign}
                              {deltaPct.toFixed(0)}%)
                            </span>
                          </td>
                          <td className="hidden px-4 py-3 text-right align-top sm:table-cell">
                            <ReasonBadge reason={it.reason} live={it.live} />
                          </td>
                        </tr>
                        <tr className="sm:hidden">
                          <td colSpan={4} className="px-4 pb-3">
                            <ReasonBadge reason={it.reason} live={it.live} />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => router.push("/sourcing")}
              className="bg-foreground text-background hover:bg-foreground/80"
            >
              Continue to sourcing &rarr;
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
