"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ForecastAdjustedItem } from "@/lib/types";

export function ForecastChart({ items }: { items: ForecastAdjustedItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={items}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="item" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="forecast" fill="#94a3b8" name="Forecast" />
        <Bar dataKey="adjusted_qty" fill="#0f172a" name="Adjusted" />
      </BarChart>
    </ResponsiveContainer>
  );
}
