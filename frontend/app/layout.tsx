import type { Metadata } from "next";
import "./globals.css";
import { WizardProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "WasteWise",
  description: "Restaurant demand forecasting and supplier sourcing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WizardProvider>
          <header className="border-b px-6 py-4">
            <h1 className="text-lg font-bold">WasteWise</h1>
          </header>
          {children}
        </WizardProvider>
      </body>
    </html>
  );
}
