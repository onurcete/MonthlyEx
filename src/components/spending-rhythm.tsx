"use client";
import { useState } from "react";
import type { AppData } from "@/lib/types";
import { buildMonthlyComparison, offsetMonth } from "@/lib/analytics";

const colors = ["#059669", "#2563eb", "#0891b2", "#7c3aed", "#d97706", "#db2777", "#4f46e5", "#0d9488", "#e11d48", "#64748b"];
const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value / 100);
const compact = (value: number) => new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
const label = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });

export default function SpendingRhythm({ data, month, card, category }: { data: AppData; month: string; card: string; category: string; onMonth?: (month: string) => void }) {
  const [splitBy, setSplitBy] = useState<"card" | "category">("card");
  const [hidden, setHidden] = useState<string[]>([]);

  const report = buildMonthlyComparison(data.expenses, data.cards, data.categories, offsetMonth(month, -11), month, splitBy, "spent", card, category);
  const visible = report.series.map((item, index) => ({ ...item, index })).filter(item => !hidden.includes(item.id));
  const totals = report.months.map(item => visible.reduce((sum, series) => sum + item.values[series.index], 0));
  const maximum = Math.max(1, ...totals);

  return <section className="panel atlas-trend">
    <div className="panel-heading">
      <div>
        <span className="atlas-kicker">12 AYLIK TREND & RİTİM</span>
        <h2>Harcama Ritmi</h2>
        <p>Son 12 ekstre ayındaki aylık harcama seyri ve kırılımı.</p>
      </div>
      <div className="segmented-control" aria-label="Trend kırılım türü">
        <button type="button" aria-pressed={splitBy === "card"} onClick={() => { setSplitBy("card"); setHidden([]); }}>Kartlar</button>
        <button type="button" aria-pressed={splitBy === "category"} onClick={() => { setSplitBy("category"); setHidden([]); }}>Kategoriler</button>
      </div>
    </div>
    <div className="rhythm-legend">
      {report.series.map((item, index) => (
        <button type="button" key={item.id} aria-pressed={!hidden.includes(item.id)} onClick={() => setHidden(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>
          <i style={{ background: colors[index % colors.length] }} />{item.name}
        </button>
      ))}
    </div>
    <div className="rhythm-columns" role="img" aria-label="Son 12 aylık harcama ritmi grafiği">
      {report.months.map((item, index) => (
        <div
          className={item.month === month ? "rhythm-column current" : "rhythm-column"}
          key={item.month}
          title={`${label(item.month)}\n${visible.map(series => `${series.name}: ${money(item.values[series.index])}`).join("\n")}\nToplam: ${money(totals[index])}`}
        >
          <strong>{compact(totals[index])}</strong>
          <span className="rhythm-track">
            {visible.map(series => <span key={series.id} style={{ height: `${item.values[series.index] / maximum * 100}%`, background: colors[series.index % colors.length] }} />)}
          </span>
          <span>{label(item.month)}</span>
        </div>
      ))}
    </div>
    <details className="chart-table rhythm-data">
      <summary>Aylık tutarları tablo olarak gör</summary>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ay</th>{visible.map(item => <th key={item.id}>{item.name}</th>)}<th>Toplam</th></tr></thead>
          <tbody>
            {report.months.map((item, index) => (
              <tr key={item.month}>
                <td>{label(item.month)}</td>
                {visible.map(series => <td key={series.id}>{money(item.values[series.index])}</td>)}
                <td><strong>{money(totals[index])}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  </section>;
}
