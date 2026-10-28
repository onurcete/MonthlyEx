import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "MonthlyEx — Harcama günlüğün", description: "Kartlarını bir araya getir, harcamalarını anlamlandır." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="tr"><body>{children}</body></html>;
}
