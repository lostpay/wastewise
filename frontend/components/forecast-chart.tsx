"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem } from "@/lib/types";

export function ForecastChart({ items }: { items: ForecastAdjustedItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={items} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="item" />
        <YAxis label={{ value: "Units", angle: -90, position: "insideLeft", style: { fontSize: 12, fill: "#71717a" } }} />
        <Tooltip formatter={(v) => Number(v).toFixed(1)} />
        <Legend />
        <Bar dataKey="forecast" fill="#94a3b8" name="Model prediction" />
        <Bar dataKey="adjusted_qty" fill="#0f172a" name="Recommended (weather + holidays)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
