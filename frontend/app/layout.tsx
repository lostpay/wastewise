import type { Metadata } from "next";
import "./globals.css";
import { WizardProvider } from "@/lib/store";
import { Stepper } from "@/components/stepper";

export const metadata: Metadata = {
  title: "WasteWise",
  description: "Restaurant demand forecasting and supplier sourcing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF9F6] text-zinc-900 antialiased selection:bg-emerald-100">
        <WizardProvider>
          <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 font-serif text-sm font-bold tracking-tighter text-white">
                  W
                </div>
                <div>
                  <h1 className="text-base font-bold tracking-tight text-zinc-900">WasteWise</h1>
                  <p className="-mt-0.5 hidden text-[11px] font-medium tracking-tight text-zinc-400 sm:block">
                    Autonomous Procurement Infrastructure
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/50 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Engine Online
                </span>
              </div>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-8 px-4 py-6 md:flex-row md:px-6 md:py-10">
            <aside className="w-full shrink-0 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05)] md:sticky md:top-24 md:w-64">
              <Stepper />
            </aside>

            <main className="min-h-[500px] w-full flex-1 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_4px_20px_-4px_rgba(0,0,0,0.04)] transition-all duration-300">
              <div className="p-6 md:p-8">{children}</div>
            </main>
          </div>
        </WizardProvider>
      </body>
    </html>
  );
}
