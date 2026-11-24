import "./globals.css";
import type { ReactNode } from "react";
import { SettingsProvider } from "@/components/Settings";

export const metadata = { title: "NEXUS 試作" };
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <div className="badge">試作（データは作り物）</div>
        <SettingsProvider>
          {children}
        </SettingsProvider>
      </body>
    </html>
  );
}
