import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, IBM_Plex_Serif } from "next/font/google";
import "./globals.css";
import { WizardProvider } from "@/lib/store";
import { Stepper } from "@/components/stepper";
import { DemoBanner } from "@/components/demo-banner";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});
const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "WasteWise",
  description: "Restaurant demand forecasting and supplier sourcing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        <WizardProvider>
          <header className="border-b border-foreground/20 bg-background">
            <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
              <div className="flex items-baseline gap-3">
                <span className="ww-num text-[10px] tracking-[0.2em] text-muted-foreground">
                  DOC-01
                </span>
                <span className="h-3 w-px bg-foreground/30" />
                <h1 className="font-heading text-lg font-semibold tracking-tight">
                  WasteWise
                </h1>
                <span className="ww-label hidden sm:inline">
                  Purchasing Advisory
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="ww-num text-[10px] text-muted-foreground">
                  {new Date().toISOString().slice(0, 10)}
                </span>
                <span className="h-3 w-px bg-foreground/30" />
                <span className="inline-flex items-center gap-1.5 border border-foreground/25 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-foreground">
                  <span className="h-1.5 w-1.5 bg-accent" />
                  Live
                </span>
              </div>
            </div>
          </header>
          <DemoBanner />

          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-0 px-4 py-8 md:flex-row md:px-6 md:py-10">
            <aside className="w-full shrink-0 border border-foreground/20 bg-sidebar p-5 md:sticky md:top-8 md:w-64">
              <Stepper />
            </aside>

            <main className="min-h-[500px] w-full flex-1 border border-foreground/20 border-t-0 bg-card md:border-l-0 md:border-t">
              <div className="p-6 md:p-8">{children}</div>
            </main>
          </div>

          <footer className="mx-auto max-w-6xl px-6 pb-10 text-center">
            <p className="ww-num text-[10px] tracking-[0.2em] text-muted-foreground">
              &mdash; END OF DOCUMENT &mdash;
            </p>
          </footer>
        </WizardProvider>
      </body>
    </html>
  );
}
