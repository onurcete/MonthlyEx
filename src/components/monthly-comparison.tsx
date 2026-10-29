"use client";

import { useState } from "react";
import type { AppData } from "@/lib/types";
import { buildMonthlyComparison, offsetMonth, type CategoryMetric } from "@/lib/analytics";
import { expenseMonth } from "@/lib/reporting-period";
import ComparisonMatrix from "./comparison-matrix";

const label = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
type Props = { data: AppData; month: string; card: string; category: string; onMonth: (month: string) => void; onCategory?: (id: string) => void };

export default function MonthlyComparison({ data, month, card, onMonth, onCategory }: Props) {
  const [grouping, setGrouping] = useState<"category" | "card">("category");
  const [period, setPeriod] = useState<"3" | "6" | "12" | "all" | "custom">("all");
  const [from, setFrom] = useState(offsetMonth(month, -5));
  const [to, setTo] = useState(month);
  const [metric] = useState<CategoryMetric>("spent");
  const allMonths = [...new Set(data.expenses.map(expenseMonth).filter((key): key is string => key !== null))].sort();
  const start = period === "all" ? allMonths[0] ?? month : period === "custom" ? from : offsetMonth(month, 1 - Number(period));
  const end = period === "all" ? allMonths.at(-1) ?? month : period === "custom" ? to : month;
  const invalid = !/^\d{4}-(0[1-9]|1[0-2])$/.test(start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) || start > end;
  const report = invalid ? null : buildMonthlyComparison(data.expenses, data.cards, data.categories, start, end, grouping, metric, card, "");
  return <section className="panel monthly-comparison">
    <div className="panel-heading comparison-heading"><div><span className="atlas-kicker">AYLAR ARASINDA</span><h2>Harcamalarını karşılaştır</h2><p>Her satır bir kategori veya kart, her sütun bir ay. Tüm kategoriler tek ekranda listelenir; bir kategoriye tıklayarak aşağıdaki trend grafiğinde inceleyebilirsin.</p></div><div className="segmented-control comparison-group" aria-label="Karşılaştırma türü"><button type="button" aria-pressed={grouping === "category"} onClick={() => setGrouping("category")}>Ana kategoriler</button><button type="button" aria-pressed={grouping === "card"} onClick={() => setGrouping("card")}>Kartlar</button></div></div>
    <div className="comparison-controls"><div className="comparison-period"><span>Dönem</span><div className="segmented-control" aria-label="Karşılaştırma dönemi">{[["3", "3 ay"], ["6", "6 ay"], ["12", "12 ay"], ["all", "Tüm aylar"], ["custom", "Aralık seç"]].map(([id, name]) => <button type="button" key={id} aria-pressed={period === id} onClick={() => setPeriod(id as typeof period)}>{name}</button>)}</div></div>
      {period === "custom" && <><label>Başlangıç<input type="month" value={from} onChange={event => setFrom(event.target.value)}/></label><label>Bitiş<input type="month" value={to} onChange={event => setTo(event.target.value)}/></label></>}
    </div>
    <p className="comparison-context">{invalid ? "Başlangıç ve bitiş ayını kontrol et." : `${label(start)} – ${label(end)} · ${card ? "Seçili kart" : "Tüm kartlar"} · Tüm kategoriler`}</p>
    {invalid ? <p className="range-error" role="alert">Başlangıç ayı bitiş ayından sonra olamaz. Her iki ayı da seç.</p> : report && <>{report.hasData ? <ComparisonMatrix key={`${grouping}:${card}`} report={report} month={month} onMonth={onMonth} onSelectSeries={grouping === "category" ? onCategory : undefined}/> : <div className="table-empty">Bu dönem ve filtrelerde karşılaştırılacak işlem yok. Başka bir dönem veya filtre seçebilirsin.</div>}
      <p className="comparison-footnote">{grouping === "card" ? "Kartlar, kaydettiğin kart adlarıyla gösterilir. " : "Alt kategoriler ana kategorilerinde toplanır. "}Tutarlar ekstre ayına göre hesaplanır. {report.compact ? "Uzun aralıkta yalnızca veri bulunan aylar gösterilir. " : "Sıfır aylar, ekstrenin yüklenmemiş olabileceği anlamına da gelebilir. "}Bir hücreye veya ay başlığına tıklayarak o aya geçebilirsin.</p></>}
  </section>;
}
