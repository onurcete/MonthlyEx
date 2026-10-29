import type { Metadata } from "next";
import "./globals.css";
import "./analytics.css";
import "./category-controls.css";
import "./atlas.css";
import "./overview-redesign.css";
export const metadata: Metadata = { title: "MonthlyEx — Harcama günlüğün", description: "Kartlarını bir araya getir, harcamalarını anlamlandır." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
