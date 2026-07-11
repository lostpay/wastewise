"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HoldoutDay } from "@/lib/types";

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)", fill: "#5a5148" };
const TOOLTIP_STYLE = {
  background: "#f7f2e8",
  border: "1px solid #1a1a1a",
  borderRadius: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
};

function short(dateISO: string): string {
  // "2026-06-23" -> "6/23"
  const [, m, d] = dateISO.split("-").map(Number);
  return `${m}/${d}`;
}

export function BacktestExplainer({ days }: { days: HoldoutDay[] }) {
  if (days.length === 0) return null;
  const dataAccuracy = days.map((d) => ({
    day: short(d.date),
    actual: d.actual,
    model: d.model,
    baseline: d.baseline,
  }));
  const totalWasteBaseline = days.reduce((s, d) => s + (d.waste_baseline_value ?? 0), 0);
  const totalWasteModel = days.reduce((s, d) => s + (d.waste_model_value ?? 0), 0);
  const hasWasteData = days.some((d) => d.waste_baseline_value != null);
  const dataWaste = [
    { label: "Rule-of-thumb", waste: Math.round(totalWasteBaseline * 100) / 100 },
    { label: "Our model", waste: Math.round(totalWasteModel * 100) / 100 },
  ];

  return (
    <div className="border border-foreground/20 bg-card">
      <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2">
        <p className="ww-label">Fig. 2 &mdash; The last 7 days, replayed</p>
        <p className="ww-num text-[10px] text-muted-foreground">
          hidden from the model, then predicted
        </p>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        {/* Left: accuracy — three lines per day */}
        <div>
          <p className="ww-label mb-1">Accuracy per day</p>
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            Closer to the grey line = better forecast. Terracotta is our
            model; dashed is the rule-of-thumb.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dataAccuracy} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="1 3" stroke="#1a1a1a20" />
              <XAxis dataKey="day" tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} />
              <YAxis tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} width={32} />
              <Tooltip
                formatter={(v) => Number(v).toFixed(1)}
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
                cursor={{ stroke: "#1a1a1a40", strokeWidth: 1 }}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
              <Line type="monotone" dataKey="actual" name="Actual sales" stroke="#1a1a1a" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="model" name="Our model" stroke="#c85a3a" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="baseline" name="Rule-of-thumb" stroke="#7a6a4a" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Right: waste — two bars */}
        <div>
          <p className="ww-label mb-1">
            Waste over the whole week
            {hasWasteData ? "" : " — no price data"}
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
            Money each forecaster would have wasted on food that
            didn&apos;t sell, over all 7 days combined. Difference is the
            &ldquo;Waste avoided&rdquo; number above.
          </p>
          {hasWasteData ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dataWaste} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="1 3" stroke="#1a1a1a20" vertical={false} />
                <XAxis dataKey="label" tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} />
                <YAxis
                  tick={TICK}
                  axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  formatter={(v) => `$${Number(v).toFixed(2)}`}
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
                  cursor={{ fill: "#1a1a1a10" }}
                />
                <Bar dataKey="waste" name="Would-be waste" fill="#c85a3a" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-[11px] italic text-muted-foreground">
              Add a <span className="ww-num mx-1">price</span> column to your
              CSV to see the dollar version.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
