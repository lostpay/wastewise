"use client";

import { useEffect, useState } from "react";
import { demoWasServed } from "@/lib/demo";

export function DemoBanner() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const sync = () => setShown(demoWasServed());
    sync();
    window.addEventListener("ww:demo-served", sync);
    window.addEventListener("ww:demo-cleared", sync);
    return () => {
      window.removeEventListener("ww:demo-served", sync);
      window.removeEventListener("ww:demo-cleared", sync);
    };
  }, []);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="border-b border-amber-700/30 bg-amber-100 px-6 py-2 text-center font-mono text-[11px] uppercase tracking-widest text-amber-900"
    >
      Demo data — figures below are canned fixtures, not live model output
    </div>
  );
}
