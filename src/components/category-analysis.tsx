"use client";

import { useRef, useState } from "react";
import type { AppData } from "@/lib/types";
import { buildCategoryRangeReport, offsetMonth, type CategoryMetric } from "@/lib/analytics";
import { categoryLabel } from "@/lib/categories";
import CategoryPicker from "./category-picker";
import InteractiveChart from "./interactive-chart";

const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value / 100);
const monthLabel = (value: string) => new Date(`${value}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
const metricLabels = { spent: "Harcama · iadeler hariç", refunds: "İadeler", net: "Net harcama · harcama − iade" };

export default function CategoryAnalysis({ data, month, selectedCategory, onCategory }: { data: AppData; month: string; selectedCategory?: string; onCategory?: (id: string) => void }) {
  const [mode, setMode] = useState<"month" | "range">("month");
  const [from, setFrom] = useState(offsetMonth(month, -2));
  const [to, setTo] = useState(month);
  const [localSelected, setLocalSelected] = useState("");
  const selected = selectedCategory ?? localSelected;
  const setSelected = onCategory ?? setLocalSelected;
  const [level, setLevel] = useState<"main" | "sub">("main");
  const [metric, setMetric] = useState<CategoryMetric>("spent");
  const initializedRange = useRef(false);
  function showRange() {
    if (!initializedRange.current) { setFrom(offsetMonth(month, -2)); setTo(month); initializedRange.current = true; }
    setMode("range");
  }
  const start = mode === "month" ? month : from;
  const end = mode === "month" ? month : to;
  const selectedId = data.categories.some(item => item.id === selected) ? selected : "";
  const invalid = !/^\d{4}-(0[1-9]|1[0-2])$/.test(start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(end) || start > end;
  const report = invalid ? null : buildCategoryRangeReport(data.expenses, data.categories, start, end, selectedId, level);
  const groups = report?.groups.slice().sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric])) ?? [];
  const groupMaximum = Math.max(1, ...groups.map(item => Math.abs(item[metric])));
  const groupSigned = groups.some(item => item[metric] < 0);
  const monthSigned = report?.months.some(item => item[metric] < 0) ?? false;
  return <section className="panel category-analysis">
    <div className="panel-heading"><div><h2>Kategori analizi</h2><p>Ekstre ayına göre aylık veya ay aralığında karşılaştırma</p></div><div className="segmented-control" aria-label="Kategori analizi dönemi"><button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>Seçili ay</button><button type="button" aria-pressed={mode === "range"} onClick={showRange}>Ay aralığı</button></div></div>
    <div className="category-analysis-controls">
      {mode === "range" ? <><label>Başlangıç ayı<input type="month" aria-label="Kategori analizi başlangıç ayı" value={from} onChange={event => setFrom(event.target.value)}/></label><label>Bitiş ayı<input type="month" aria-label="Kategori analizi bitiş ayı" value={to} onChange={event => setTo(event.target.value)}/></label></> : <div className="analysis-selected-month"><small>Seçili ekstre ayı</small><strong>{monthLabel(month)}</strong></div>}
      <label className="category-analysis-filter">Kategori / alt kategori<CategoryPicker label="Grafik için kategori veya alt kategori seç" categories={data.categories} value={selectedId} onChange={setSelected}/>{selectedId && <button type="button" className="text-button" onClick={() => setSelected("")}>Tüm kategorilere dön</button>}</label>
    </div>
    {invalid ? <p className="range-error" role="alert">Başlangıç ayı bitiş ayından sonra olamaz. Her iki ayı da seçin.</p> : report && <>
      <div className="range-summary"><span>{monthLabel(start)}{start !== end ? ` – ${monthLabel(end)}` : ""} · {selectedId ? categoryLabel(data.categories, selectedId) : "Tüm kategoriler"}</span><span>Toplam Harcama <strong>{money(report.spent)}</strong></span></div>
      <div className="range-charts">
        <div className="range-ranking"><div className="range-chart-heading"><h3>Kategori karşılaştırması</h3><div className="segmented-control" aria-label="Kategori ayrıntı seviyesi"><button type="button" aria-pressed={level === "main"} onClick={() => setLevel("main")}>Ana kategori</button><button type="button" aria-pressed={level === "sub"} onClick={() => setLevel("sub")}>Alt kategori</button></div></div>
          {groups.map(item => {
            const width = Math.abs(item[metric]) / groupMaximum * (groupSigned ? 50 : 100);
            return <button type="button" className="range-ranking-row" key={item.id} onClick={() => { setSelected(item.id); setLevel("sub"); }} aria-label={`${item.name}, ${money(item[metric])}, ayrıntıya in`}><div><span>{item.name}</span><strong>{money(item[metric])} ↗</strong></div><div className="range-bar-track">{groupSigned && <i/>}<span style={{ width: `${width}%`, left: `${groupSigned ? item[metric] < 0 ? 50 - width : 50 : 0}%`, background: item[metric] < 0 ? "#2563eb" : "#059669" }}/></div></button>;
          })}
          {!groups.length && <p className="chart-note">Seçili dönem ve kategoride kayıtlı işlem yok.</p>}
        </div>
        <div className="range-months"><div className="range-chart-heading"><h3>Aylara göre {metric === "refunds" ? "iade" : metric === "net" ? "net harcama" : "harcama"}</h3></div>
          <InteractiveChart title="Dönem bazında kategori analizi" points={report.months.map(item => ({ key: item.month, label: monthLabel(item.month), values: [item[metric]] }))} series={[{ name: metric === "refunds" ? "İade" : metric === "net" ? "Net harcama" : "Harcama", color: "#059669" }]} defaultMode="bar"/>
          <p className="chart-note">{metricLabels[metric]}. {report.compact ? "Uzun aralıkta yalnızca veri bulunan aylar gösteriliyor." : "İşlem bulunmayan aylarda sıfır gösterilir; bu aylara ait ekstrenin yüklenmemiş olması da mümkündür."} {groupSigned || monthSigned ? "Negatif değerler iadelerin harcamayı aştığını gösterir." : ""}</p>
        </div>
      </div>
    </>}
  </section>;
}
