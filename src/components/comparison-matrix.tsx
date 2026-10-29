"use client";
import { useState } from "react";
import type { buildMonthlyComparison } from "@/lib/analytics";

const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value / 100);
const label = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
type Report = ReturnType<typeof buildMonthlyComparison>;
export default function ComparisonMatrix({ report, month, onMonth, onSelectSeries }: { report: Report; month: string; onMonth: (month: string) => void; onSelectSeries?: (id: string) => void }) {
  const [selected, setSelected] = useState<{ id: string; month: string } | null>(null);
  const maximum = report.months.reduce((max, item) => item.values.reduce((value, amount) => Math.max(value, Math.abs(amount)), max), 1);
  const rowTotals = report.series.map((_, index) => report.months.reduce((sum, item) => sum + item.values[index], 0));
  const columnTotals = report.months.map(item => item.values.reduce((sum, amount) => sum + amount, 0));
  const selectedSeries = report.series.findIndex(item => item.id === selected?.id);
  const selectedMonth = report.months.find(item => item.month === selected?.month);
  return <div className="comparison-matrix"><div className="matrix-legend"><span><i/> Açık renk: düşük · koyu renk: yüksek tutar</span></div><div className="matrix-scroll"><table><thead><tr><th>Kategori / kart</th>{report.months.map(item => <th key={item.month} className={item.month === month ? "matrix-current" : ""}><button type="button" onClick={() => onMonth(item.month)}>{label(item.month)} ↗</button></th>)}<th>Dönem toplamı</th></tr></thead><tbody>{report.series.map((series, index) => <tr key={series.id}><th scope="row">{onSelectSeries ? <button type="button" className="matrix-row-label-btn" onClick={() => onSelectSeries(series.id)}>{series.name}</button> : series.name}</th>{report.months.map(item => {
    const amount = item.values[index];
    const tint = amount === 0 ? 0 : 8 + Math.abs(amount) / maximum * 35;
    return <td key={item.month}><button type="button" className={selected?.id === series.id && selected.month === item.month ? "matrix-cell selected" : "matrix-cell"} style={{ background: `color-mix(in srgb, ${amount < 0 ? "#2563eb" : "#059669"} ${tint}%, #ffffff)` }} title={`${series.name} · ${label(item.month)}: ${money(amount)}`} aria-label={`${series.name}, ${label(item.month)}, ${money(amount)}. Bu aya geç.`} aria-pressed={selected?.id === series.id && selected.month === item.month} onClick={() => { setSelected({ id: series.id, month: item.month }); onSelectSeries?.(series.id); onMonth(item.month); }}>{money(amount)}</button></td>;
  })}<td className="matrix-row-total">{money(rowTotals[index])}</td></tr>)}</tbody><tfoot><tr><th scope="row">Toplam</th>{columnTotals.map((amount, index) => <td key={report.months[index].month}>{money(amount)}</td>)}<td>{money(rowTotals.reduce((sum, amount) => sum + amount, 0))}</td></tr></tfoot></table></div>{selectedMonth && selectedSeries >= 0 && <p className="matrix-selection" role="status"><strong>{report.series[selectedSeries].name}</strong> · {label(selectedMonth.month)} · {money(selectedMonth.values[selectedSeries])}</p>}</div>;
}
