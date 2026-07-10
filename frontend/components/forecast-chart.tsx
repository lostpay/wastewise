"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem } from "@/lib/types";

const TICK = { fontSize: 10, fontFamily: "var(--font-mono)", fill: "#5a5148" };

export function ForecastChart({ items }: { items: ForecastAdjustedItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={items} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <XAxis dataKey="item" tick={TICK} axisLine={{ stroke: "#1a1a1a", strokeWidth: 1 }} tickLine={false} interval={0} />
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
          cursor={{ fill: "#1a1a1a08" }}
        />
        <Bar dataKey="forecast" fill="#7a6a4a" name="Model prediction" />
        <Bar dataKey="adjusted_qty" fill="#1a1a1a" name="Recommended" />
      </BarChart>
    </ResponsiveContainer>
  );
}
