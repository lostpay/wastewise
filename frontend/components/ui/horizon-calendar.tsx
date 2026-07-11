"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HorizonCalendarProps {
  start: string; // ISO "YYYY-MM-DD": first forecast day (locked anchor)
  days: number; // currently selected length (>= 1)
  maxDays?: number; // default 14
  onChange: (days: number) => void;
}

const MS_PER_DAY = 86_400_000;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}
function fmt(d: Date): string {
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

export function HorizonCalendar({ start, days, maxDays = 14, onChange }: HorizonCalendarProps) {
  const startDate = parseISO(start);
  const lastSelectable = addDays(startDate, maxDays - 1);
  const endDate = addDays(startDate, days - 1);
  // The view month defaults to the anchor's month; the [start, start+maxDays-1]
  // window can spill into the next month, so allow navigation between them.
  const [view, setView] = useState({ y: startDate.getUTCFullYear(), m: startDate.getUTCMonth() });

  const firstOfMonth = new Date(Date.UTC(view.y, view.m, 1));
  const leadBlanks = firstOfMonth.getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < leadBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(view.y, view.m, d)));

  const inWindow = (d: Date) => d.getTime() >= startDate.getTime() && d.getTime() <= lastSelectable.getTime();
  const inRange = (d: Date) => d.getTime() >= startDate.getTime() && d.getTime() <= endDate.getTime();

  return (
    <div className="border border-foreground/25 bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="ww-num text-sm font-medium">{MONTHS[view.m]} {view.y}</span>
        <button
          type="button"
          aria-label="Next month"
          className="p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="ww-label pb-1 text-center text-[10px] text-muted-foreground">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const selectable = inWindow(d);
          const ranged = inRange(d);
          const isStart = d.getTime() === startDate.getTime();
          const isEnd = d.getTime() === endDate.getTime();
          return (
            <button
              key={i}
              type="button"
              disabled={!selectable}
              onClick={() => onChange(diffDays(startDate, d) + 1)}
              className={cn(
                "ww-num h-8 text-sm transition-colors",
                !selectable && "text-muted-foreground/40",
                selectable && !ranged && "hover:bg-foreground/10",
                ranged && "bg-accent/20",
                (isStart || isEnd) && "bg-accent text-background font-semibold",
              )}
            >
              {d.getUTCDate()}
            </button>
          );
        })}
      </div>

      <p className="ww-num mt-3 border-t border-dashed border-foreground/20 pt-2 text-center text-xs text-muted-foreground">
        {fmt(startDate)} &rarr; {fmt(endDate)} &middot;{" "}
        <span className="font-medium text-foreground">{days} day{days === 1 ? "" : "s"}</span>
      </p>
    </div>
  );
}
