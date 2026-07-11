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
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!datasetId) {
      router.push("/setup");
      return;
    }
    if (forecast || started.current) return;
    started.current = true;
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
          from your history and adds a spoilage-aware safety buffer (5–15% by
          shelf life); an AI agent then adjusts only when weather or holidays
          warrant it, capped at ±25%.
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label="Base-model accuracy gain vs. simple seasonal baseline"
              value={`${Math.round(forecast.baseline_delta * 100)}%`}
              hint="Lower mean absolute error on a 7-day holdout vs. a naive same-weekday baseline. Measured on the base model, before the AI weather adjustment. Higher is better."
            />
            {(forecast.waste_avoided_units ?? 0) > 0 ? (
              <StatTile
                label="Over-ordering avoided vs. baseline"
                value={
                  forecast.waste_avoided_value != null
                    ? `$${forecast.waste_avoided_value.toFixed(2)}`
                    : `${(forecast.waste_avoided_units ?? 0).toFixed(0)} units`
                }
                hint="Same 7-day holdout: what a naive same-weekday ordering policy would have over-bought, minus this model's over-buy — both with the same 15% buffer (the backtest compares policies, not the spoilage-aware buffers)."
              />
            ) : null}
            {forecast.adjustment ? (
              <StatTile
                label="AI weather adjustment (net)"
                value={`${forecast.adjustment.net_delta_pct >= 0 ? "+" : ""}${forecast.adjustment.net_delta_pct.toFixed(1)}%`}
                hint={`${forecast.adjustment.n_up} raised, ${forecast.adjustment.n_down} lowered, ${forecast.adjustment.n_unchanged} unchanged vs. the buffered recommendation. Each item is capped at ±25%.`}
              />
            ) : null}
          </div>
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
                    <th className="ww-label px-4 py-2 text-right">+ Buffer</th>
                    <th className="ww-label px-4 py-2 text-right">AI adj.</th>
                    <th className="ww-label px-4 py-2 text-right">Δ</th>
                    <th className="ww-label hidden px-4 py-2 text-right sm:table-cell">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.items.map((it, idx) => {
                    const rec = it.recommended ?? it.forecast;
                    const delta = it.adjusted_qty - rec;
                    const deltaPct = rec ? (delta / rec) * 100 : 0;
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
                          <td className="px-4 py-3 text-sm font-medium capitalize">
                            {it.item}
                            {it.spoilage_risk === "high" ? (
                              <span className="ww-label ml-2 text-amber-700">high spoilage</span>
                            ) : null}
                            {it.shelf_life_days != null ? (
                              <span className="ww-num block text-[10px] font-normal normal-case text-muted-foreground">
                                ~{it.shelf_life_days}-day shelf life
                              </span>
                            ) : null}
                          </td>
                          <td className="ww-num px-4 py-3 text-right text-sm text-muted-foreground">
                            {it.forecast.toFixed(1)}
                          </td>
                          <td className="ww-num px-4 py-3 text-right text-sm text-muted-foreground">
                            {rec.toFixed(1)}
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
                          <td colSpan={5} className="px-4 pb-3">
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
