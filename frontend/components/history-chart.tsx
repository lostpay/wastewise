"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem, HistoryPoint } from "@/lib/types";

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)", fill: "#5a5148" };

export function HistoryChart({
  history,
  items,
}: {
  history: HistoryPoint[];
  items: ForecastAdjustedItem[];
}) {
  const [selected, setSelected] = useState(items[0]?.item ?? "");

  const data = useMemo(() => {
    const hist = history
      .filter((p) => p.item === selected)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (hist.length === 0) return [];
    const rows: { date: string; actual: number | null; forecast: number | null }[] =
      hist.map((p) => ({ date: p.date, actual: p.quantity, forecast: null }));
    const daily = items.find((i) => i.item === selected)?.daily ?? [];
    // Anchor the forecast segment to the last actual point so the lines connect.
    rows[rows.length - 1].forecast = hist[hist.length - 1].quantity;
    const last = new Date(hist[hist.length - 1].date + "T00:00:00Z");
    daily.forEach((q, i) => {
      const d = new Date(last);
      d.setUTCDate(last.getUTCDate() + i + 1);
      rows.push({ date: d.toISOString().slice(0, 10), actual: null, forecast: q });
    });
    return rows;
  }, [history, items, selected]);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2">
        <p className="ww-label">Fig. 2 — Sales history &amp; forecast</p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Chart item"
          className="ww-num h-7 border border-foreground/25 bg-card px-2 text-xs capitalize focus:border-accent focus:outline-none"
        >
          {items.map((i) => (
            <option key={i.item} value={i.item}>
              {i.item}
            </option>
          ))}
        </select>
      </div>
      <div className="p-4">
        {/* Selecting an item with no uploaded history must not unmount the whole
            card (and its selector) -- show an empty state and keep the picker. */}
        {data.length === 0 ? (
          <p className="ww-num py-16 text-center text-xs text-muted-foreground">
            No sales history for this item.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="date" tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} minTickGap={24} />
            <YAxis tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} width={40} />
            <Tooltip
              formatter={(v) => Number(v).toFixed(1)}
              contentStyle={{
                background: "#f7f2e8",
                border: "1px solid #1a1a1a",
                borderRadius: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              labelStyle={{ fontFamily: "var(--font-sans)", fontWeight: 600 }}
            />
            <Line type="monotone" dataKey="actual" stroke="#7a6a4a" strokeWidth={1.5} dot={false} name="Actual sales" />
            <Line type="monotone" dataKey="forecast" stroke="#1a1a1a" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="Forecast" />
          </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
