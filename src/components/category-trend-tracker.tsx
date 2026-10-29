"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Check, Layers, LineChart, Target, TrendingDown, TrendingUp, X } from "lucide-react";
import type { AppData, Expense } from "@/lib/types";
import { offsetMonth, totals } from "@/lib/analytics";
import { categoryLabel } from "@/lib/categories";
import { expenseMonth } from "@/lib/reporting-period";
import CategoryPicker from "./category-picker";

const seriesColors = ["#059669", "#2563eb", "#7c3aed", "#d97706", "#db2777", "#0891b2", "#4f46e5", "#e11d48"];

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value / 100);

const barMoney = (value: number, dense: boolean) => {
  if (value === 0) return "₺0";
  if (dense) {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value / 100);
  }
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Math.round(value / 100));
};

const axisCompact = (value: number) =>
  new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);

const monthShort = (value: string) =>
  new Date(`${value}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });

export default function CategoryTrendTracker({
  data,
  month,
  card,
  externalCategory,
  onSelectCategory,
}: {
  data: AppData;
  month: string;
  card: string;
  externalCategory?: string;
  onSelectCategory?: (id: string) => void;
}) {
  const roots = data.categories.filter(item => item.parentId === null);
  const categoryById = new Map(data.categories.map(item => [item.id, item]));
  const filteredExpenses = data.expenses.filter(row => !card || row.cardId === card);

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    externalCategory && data.categories.some(c => c.id === externalCategory) ? [externalCategory] : []
  );
  const [period, setPeriod] = useState<"6" | "12" | "all">("12");
  const [chartMode, setChartMode] = useState<"bar" | "area" | "line">("bar");
  const [multiView, setMultiView] = useState<"combined" | "split">("combined");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chartHostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(860);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    if (!chartHostRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(320, entry.contentRect.width));
    });
    observer.observe(chartHostRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (externalCategory !== undefined) {
      if (!externalCategory) {
        setSelectedIds([]);
      } else if (data.categories.some(c => c.id === externalCategory)) {
        setSelectedIds(current => (current.includes(externalCategory) ? current : [externalCategory]));
      }
    }
  }, [externalCategory, data.categories]);

  // Toggle a main (root) category in multi-select
  function toggleRootCategory(rootId: string) {
    setSelectedIds(current => {
      const childIds = data.categories.filter(c => c.parentId === rootId).map(c => c.id);
      const isRootSelected = current.includes(rootId);
      const hasChildrenSelected = current.some(id => childIds.includes(id));

      if (isRootSelected) {
        return current.filter(id => id !== rootId);
      }
      if (hasChildrenSelected) {
        // Replace partial children selection with the whole root category
        return [...current.filter(id => !childIds.includes(id)), rootId];
      }
      return [...current, rootId];
    });
  }

  // Toggle a subcategory in multi-select
  function toggleSubCategory(subId: string) {
    const sub = categoryById.get(subId);
    if (!sub) return;
    const parentId = sub.parentId;

    setSelectedIds(current => {
      if (current.includes(subId)) {
        return current.filter(id => id !== subId);
      }
      // If parent root was selected as a whole, narrow down from parent root to this subcategory
      const withoutParent = parentId ? current.filter(id => id !== parentId) : current;
      return [...withoutParent, subId];
    });
  }

  // Handle selection from CategoryPicker dropdown (adds/toggles category)
  function handlePickerChange(id: string) {
    if (!id) {
      setSelectedIds([]);
      onSelectCategory?.("");
      return;
    }
    const item = categoryById.get(id);
    if (!item) return;
    if (item.parentId === null) {
      toggleRootCategory(id);
    } else {
      toggleSubCategory(id);
    }
  }

  function removeSelected(id: string) {
    setSelectedIds(current => current.filter(item => item !== id));
  }

  function clearAllSelected() {
    setSelectedIds([]);
    onSelectCategory?.("");
  }

  // Determine which root categories have subcategories visible in the subcategory bar
  const activeRootIds = [...new Set(
    selectedIds.map(id => {
      const cat = categoryById.get(id);
      return cat ? (cat.parentId ?? cat.id) : "";
    }).filter(Boolean)
  )];

  const allMonths = [...new Set(filteredExpenses.map(expenseMonth).filter((key): key is string => key !== null))].sort();
  const start =
    period === "all"
      ? allMonths[0] ?? offsetMonth(month, -11)
      : offsetMonth(month, 1 - Number(period));
  const end = period === "all" ? (allMonths.at(-1) && allMonths.at(-1)! > month ? allMonths.at(-1)! : month) : month;

  const monthCount = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5)) - Number(start.slice(5)) + 1;
  const monthKeys = Array.from({ length: Math.max(1, monthCount) }, (_, index) => offsetMonth(start, index));

  const rowMatchesSelection = (row: Expense, ids: string[]) => {
    if (ids.length === 0) return true;
    const cat = categoryById.get(row.category);
    const parentId = cat?.parentId ?? null;
    return ids.includes(row.category) || (parentId !== null && ids.includes(parentId));
  };

  const rangeRows = filteredExpenses.filter(row => {
    const key = expenseMonth(row);
    return key !== null && key >= start && key <= end && rowMatchesSelection(row, selectedIds);
  });

  const overallTotals = totals(rangeRows);

  const monthlyPoints = monthKeys.map((mKey, idx) => {
    const mRows = rangeRows.filter(row => expenseMonth(row) === mKey);
    const mTotals = totals(mRows);
    const seriesValues = selectedIds.map(selId => {
      const sRows = mRows.filter(row => rowMatchesSelection(row, [selId]));
      return totals(sRows).spent;
    });
    return {
      month: mKey,
      label: monthShort(mKey),
      spent: mTotals.spent,
      count: mTotals.count,
      seriesValues,
      prev: null as number | null,
      diff: null as number | null,
      pct: null as number | null,
    };
  });

  for (let i = 0; i < monthlyPoints.length; i++) {
    const prev = i > 0 ? monthlyPoints[i - 1].spent : null;
    const diff = prev !== null ? monthlyPoints[i].spent - prev : null;
    const pct = prev !== null && prev > 0 ? ((monthlyPoints[i].spent - prev) / prev) * 100 : null;
    monthlyPoints[i].prev = prev;
    monthlyPoints[i].diff = diff;
    monthlyPoints[i].pct = pct;
  }

  const currentMonthData = monthlyPoints.find(m => m.month === month) ?? monthlyPoints.at(-1);
  const currentSpent = currentMonthData?.spent ?? 0;
  const prevSpent = currentMonthData?.prev ?? 0;
  const momDiff = currentMonthData?.diff ?? 0;
  const momPct = currentMonthData?.pct ?? null;

  const activeMonths = monthlyPoints.filter(m => m.spent > 0);
  const averageSpent =
    monthlyPoints.length > 0
      ? Math.round(monthlyPoints.reduce((sum, m) => sum + m.spent, 0) / monthlyPoints.length)
      : 0;
  const activeAverageSpent =
    activeMonths.length > 0
      ? Math.round(activeMonths.reduce((sum, m) => sum + m.spent, 0) / activeMonths.length)
      : 0;
  const referenceAvg = activeAverageSpent || averageSpent;
  const vsAvgDiff = currentSpent - referenceAvg;
  const vsAvgPct = referenceAvg > 0 ? ((currentSpent - referenceAvg) / referenceAvg) * 100 : null;

  const peakMonth =
    monthlyPoints.reduce<{ month: string; label: string; spent: number } | null>(
      (best, item) => (!best || item.spent > best.spent ? item : best),
      null
    ) ?? null;

  const selectedLabel =
    selectedIds.length === 0
      ? "Tüm Kategoriler (Toplam)"
      : selectedIds.length <= 2
        ? selectedIds.map(id => categoryLabel(data.categories, id)).join(" + ")
        : `${selectedIds.length} Kategori Seçili`;

  const showSplitSeries = selectedIds.length > 1 && multiView === "split";

  // SVG Chart Geometry
  const height = 315;
  const padLeft = 62;
  const padRight = 24;
  const padTop = 46;
  const padBottom = 42;
  const plotWidth = Math.max(100, width - padLeft - padRight);
  const plotHeight = height - padTop - padBottom;
  const count = Math.max(1, monthlyPoints.length);

  const maxVal = showSplitSeries
    ? Math.max(1, ...monthlyPoints.flatMap(p => p.seriesValues))
    : Math.max(1, ...monthlyPoints.map(p => p.spent));
  const high = maxVal * 1.24;

  const xFor = (index: number) => padLeft + (plotWidth * (index + 0.5)) / count;
  const yFor = (value: number) => padTop + ((high - value) / high) * plotHeight;
  const baselineY = yFor(0);
  const slotWidth = plotWidth / count;
  const barWidth = Math.max(14, Math.min(48, slotWidth * 0.52));
  const dense = count > 12 || slotWidth < 62;

  const activePoint = hoverIndex !== null && monthlyPoints[hoverIndex] ? monthlyPoints[hoverIndex] : null;
  const lineCoords = monthlyPoints.map((p, idx) => `${xFor(idx)},${yFor(p.spent)}`).join(" L ");

  return (
    <section className="panel category-trend-panel">
      <div className="panel-heading category-trend-heading">
        <div>
          <span className="atlas-kicker">
            <Target size={13} /> KATEGORİ AZALTMA & TREND TAKİBİ
          </span>
          <h2>Kategori Aylık Değişim Grafiği</h2>
          <p>
            Hiçbir kategori seçmeden genel toplamı veya birden fazla ana / alt kategori seçerek ay ay harcama değişimini
            izle.
          </p>
        </div>

        <div className="category-trend-controls">
          <div className="category-trend-picker-wrap">
            <CategoryPicker
              label="Trend grafiğine kategori veya alt kategori ekle/çıkar"
              placeholder="Kategori ekle / seç…"
              categories={data.categories}
              value={selectedIds[selectedIds.length - 1] ?? ""}
              onChange={handlePickerChange}
            />
          </div>

          {selectedIds.length > 1 && (
            <div className="segmented-control" aria-label="Çoklu kategori görünümü">
              <button
                type="button"
                aria-pressed={multiView === "combined"}
                onClick={() => setMultiView("combined")}
              >
                Birleşik Toplam
              </button>
              <button
                type="button"
                aria-pressed={multiView === "split"}
                onClick={() => setMultiView("split")}
              >
                Ayrı Ayrı Kıyasla
              </button>
            </div>
          )}

          <div className="segmented-control" aria-label="Grafik türü">
            <button type="button" aria-pressed={chartMode === "bar"} onClick={() => setChartMode("bar")}>
              <BarChart3 size={13} /> Sütun
            </button>
            <button type="button" aria-pressed={chartMode === "area"} onClick={() => setChartMode("area")}>
              <LineChart size={13} /> Çizgi & Alan
            </button>
            <button type="button" aria-pressed={chartMode === "line"} onClick={() => setChartMode("line")}>
              Çizgi
            </button>
          </div>

          <div className="segmented-control" aria-label="Trend dönemi">
            {(
              [
                ["6", "Son 6 Ay"],
                ["12", "Son 12 Ay"],
                ["all", "Tüm Aylar"],
              ] as const
            ).map(([id, name]) => (
              <button type="button" key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Çoklu Ana Kategori ve Alt Kategori Seçim Alanı */}
      <div className="trend-quick-Selector">
        <div className="trend-root-pills" role="group" aria-label="Ana kategoriler (birden fazla seçilebilir)">
          <button
            type="button"
            className={`trend-pill ${selectedIds.length === 0 ? "active" : ""}`}
            aria-pressed={selectedIds.length === 0}
            onClick={clearAllSelected}
          >
            Tüm Kategoriler (Toplam)
          </button>
          {roots.map(root => {
            const isExactRootSelected = selectedIds.includes(root.id);
            const hasSubSelected = activeRootIds.includes(root.id) && !isExactRootSelected;
            return (
              <button
                key={root.id}
                type="button"
                className={`trend-pill ${isExactRootSelected ? "active" : hasSubSelected ? "partial" : ""}`}
                aria-pressed={isExactRootSelected || hasSubSelected}
                onClick={() => toggleRootCategory(root.id)}
              >
                {(isExactRootSelected || hasSubSelected) && <Check size={12} />}
                <span>{root.name}</span>
              </button>
            );
          })}
        </div>

        {/* Seçili Ana Kategorilerin Alt Kategorileri (Çoklu Seçilebilir) */}
        {activeRootIds.length > 0 && (
          <div className="trend-sub-groups">
            {activeRootIds.map(rootId => {
              const rootCat = categoryById.get(rootId);
              const subs = data.categories.filter(c => c.parentId === rootId);
              if (!rootCat || subs.length === 0) return null;
              const isWholeRootSelected = selectedIds.includes(rootId);

              return (
                <div key={rootId} className="trend-sub-pills" role="group" aria-label={`${rootCat.name} alt kategorileri`}>
                  <span className="trend-sub-label">
                    <Layers size={12} /> {rootCat.name}:
                  </span>
                  <button
                    type="button"
                    className={`trend-sub-pill ${isWholeRootSelected ? "active" : ""}`}
                    aria-pressed={isWholeRootSelected}
                    onClick={() => {
                      const childIds = subs.map(s => s.id);
                      setSelectedIds(current =>
                        isWholeRootSelected
                          ? current.filter(id => id !== rootId)
                          : [...current.filter(id => !childIds.includes(id)), rootId]
                      );
                    }}
                  >
                    Tümü ({rootCat.name})
                  </button>
                  {subs.map(sub => {
                    const isSubSelected = selectedIds.includes(sub.id);
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className={`trend-sub-pill ${isSubSelected ? "active" : ""}`}
                        aria-pressed={isSubSelected}
                        onClick={() => toggleSubCategory(sub.id)}
                      >
                        {isSubSelected && <Check size={11} />}
                        <span>{sub.name}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Seçili Kategoriler Rozet Şeridi */}
        {selectedIds.length > 0 && (
          <div className="trend-selected-bar">
            <span className="trend-selected-title">Seçili ({selectedIds.length}):</span>
            {selectedIds.map((id, idx) => (
              <span key={id} className="trend-selected-chip">
                <i
                  style={{
                    background: showSplitSeries ? seriesColors[idx % seriesColors.length] : "#059669",
                  }}
                />
                {categoryLabel(data.categories, id)}
                <button
                  type="button"
                  aria-label={`${categoryLabel(data.categories, id)} seçimini kaldır`}
                  onClick={() => removeSelected(id)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button type="button" className="atlas-clear" onClick={clearAllSelected}>
              <X size={12} /> Tümünü temizle (Toplama dön)
            </button>
          </div>
        )}
      </div>

      {/* Azaltma & Hedef Metrik Kartları */}
      <div className="trend-kpi-strip">
        <div className="trend-kpi-box">
          <span className="trend-kpi-label">SEÇİLİ AY ({monthShort(month)})</span>
          <div className="trend-kpi-main">
            <strong>{money(currentSpent)}</strong>
            {momPct !== null ? (
              <span className={`fintech-badge ${momDiff <= 0 ? "down" : "up"}`}>
                {momDiff <= 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                {momDiff <= 0 ? "↓ " : "↑ "}%{Math.abs(momPct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
              </span>
            ) : (
              <span className="fintech-badge neutral">Önceki ay yok</span>
            )}
          </div>
          <small>
            Geçen ay: <b>{money(prevSpent)}</b>{" "}
            {momDiff !== 0 && (
              <span>
                ({momDiff > 0 ? "+" : ""}
                {money(momDiff)})
              </span>
            )}
          </small>
        </div>

        <div className="trend-kpi-box">
          <span className="trend-kpi-label">AYLIK ORTALAMA İLE KIYAS</span>
          <div className="trend-kpi-main">
            <strong>{money(referenceAvg)}</strong>
            {vsAvgPct !== null && (
              <span className={`fintech-badge ${vsAvgDiff <= 0 ? "down" : "up"}`}>
                {vsAvgDiff <= 0 ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                Ortalamadan %{Math.abs(vsAvgPct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}{" "}
                {vsAvgDiff <= 0 ? "daha az" : "daha fazla"}
              </span>
            )}
          </div>
          <small>
            {activeMonths.length} aktif ayın ortalaması · Dönem ort: <b>{money(averageSpent)}</b>
          </small>
        </div>

        <div className="trend-kpi-box">
          <span className="trend-kpi-label">DÖNEM ZİRVESİ (EN YÜKSEK AY)</span>
          <div className="trend-kpi-main">
            <strong>{peakMonth && peakMonth.spent > 0 ? money(peakMonth.spent) : "—"}</strong>
            {peakMonth && peakMonth.spent > 0 && (
              <span className="fintech-badge neutral">{peakMonth.label}</span>
            )}
          </div>
          <small>
            {peakMonth && peakMonth.spent > 0 && currentSpent < peakMonth.spent
              ? `Zirveye göre ${money(peakMonth.spent - currentSpent)} daha düşük`
              : peakMonth && peakMonth.spent > 0 && currentSpent === peakMonth.spent
                ? "Bu ay dönem zirvesinde"
                : "Henüz harcama kaydı yok"}
          </small>
        </div>

        <div className="trend-kpi-box">
          <span className="trend-kpi-label">SEÇİLİ KAPSAM TOPLAMI</span>
          <div className="trend-kpi-main">
            <strong>{money(overallTotals.spent)}</strong>
            <span className="fintech-badge neutral">{overallTotals.count} işlem</span>
          </div>
          <small>{selectedLabel}</small>
        </div>
      </div>

      {/* Özel SVG Grafik: Barlar Üzerinde Rakamlar + SADECE Sütun Modunda Barlardan Barlara Oklar + Çizgi/Alan */}
      <div className="trend-chart-container" ref={chartHostRef}>
        <div className="trend-svg-wrapper">
          <svg
            width="100%"
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`${selectedLabel} aylık değişim grafiği`}
            onPointerLeave={() => setHoverIndex(null)}
          >
            <defs>
              <linearGradient id={`${uid}-area`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id={`${uid}-bar`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#059669" />
                <stop offset="100%" stopColor="#047857" />
              </linearGradient>
              <linearGradient id={`${uid}-bar-current`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#0f172a" />
                <stop offset="100%" stopColor="#1e293b" />
              </linearGradient>
              <marker
                id={`${uid}-arrow-down`}
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#059669" />
              </marker>
              <marker
                id={`${uid}-arrow-up`}
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#dc2626" />
              </marker>
              <marker
                id={`${uid}-arrow-flat`}
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M 0 2 L 8 5 L 0 8 z" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Yatay Kılavuz Çizgileri */}
            {[0, 0.33, 0.66, 1].map((ratio, idx) => {
              const val = (high / 1.24) * ratio;
              const yPos = yFor(val);
              return (
                <g key={idx}>
                  <line x1={padLeft} x2={width - padRight} y1={yPos} y2={yPos} className="chart-gridline" />
                  <text x={padLeft - 10} y={yPos + 4} textAnchor="end" className="trend-axis-text">
                    {axisCompact(val)}
                  </text>
                </g>
              );
            })}

            {/* Ortalama Referans Çizgisi (Birleşik görünümde) */}
            {!showSplitSeries && referenceAvg > 0 && (
              <g>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={yFor(referenceAvg)}
                  y2={yFor(referenceAvg)}
                  stroke="#64748b"
                  strokeWidth="1.2"
                  strokeDasharray="5 4"
                  opacity="0.65"
                />
                <text
                  x={width - padRight - 4}
                  y={yFor(referenceAvg) - 5}
                  textAnchor="end"
                  className="trend-avg-line-label"
                >
                  Ort: {barMoney(referenceAvg, true)}
                </text>
              </g>
            )}

            {/* 1. BİRLEŞİK TOPLAM GÖRÜNÜMÜ */}
            {!showSplitSeries && (
              <>
                {/* Çizgi ve Alan Modu */}
                {chartMode !== "bar" && monthlyPoints.length > 0 && (
                  <g>
                    {chartMode === "area" && (
                      <path
                        d={`M ${xFor(0)},${baselineY} L ${lineCoords} L ${xFor(monthlyPoints.length - 1)},${baselineY} Z`}
                        fill={`url(#${uid}-area)`}
                      />
                    )}
                    <path
                      d={`M ${lineCoords}`}
                      fill="none"
                      stroke="#059669"
                      strokeWidth="2.75"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {/* Sütun (Bar) Modu */}
                {chartMode === "bar" &&
                  monthlyPoints.map((item, idx) => {
                    const cx = xFor(idx);
                    const topY = yFor(item.spent);
                    const barH = Math.max(2, baselineY - topY);
                    const isCurrent = item.month === month;
                    return (
                      <g
                        key={item.month}
                        onPointerEnter={() => setHoverIndex(idx)}
                        style={{ cursor: "pointer" }}
                      >
                        <rect
                          x={cx - barWidth / 2}
                          y={topY}
                          width={barWidth}
                          height={barH}
                          rx="5"
                          fill={isCurrent ? `url(#${uid}-bar-current)` : `url(#${uid}-bar)`}
                          opacity={hoverIndex === null || hoverIndex === idx ? 1 : 0.65}
                        />
                      </g>
                    );
                  })}

                {/* Noktalar (Çizgi ve Alan modunda) */}
                {chartMode !== "bar" &&
                  monthlyPoints.map((item, idx) => {
                    const cx = xFor(idx);
                    const cy = yFor(item.spent);
                    const isCurrent = item.month === month;
                    return (
                      <circle
                        key={item.month}
                        cx={cx}
                        cy={cy}
                        r={isCurrent || hoverIndex === idx ? 6 : 4.5}
                        fill={isCurrent ? "#0f172a" : "#059669"}
                        stroke="#ffffff"
                        strokeWidth="2"
                        onPointerEnter={() => setHoverIndex(idx)}
                        style={{ cursor: "pointer" }}
                      />
                    );
                  })}

                {/* Barlardan Barlara Oklar — YALNIZCA SÜTUN (BAR) MODUNDA */}
                {chartMode === "bar" &&
                  monthlyPoints.map((item, idx) => {
                    if (idx === 0) return null;
                    const prevItem = monthlyPoints[idx - 1];
                    if (prevItem.spent === 0 && item.spent === 0) return null;

                    const x1 = xFor(idx - 1);
                    const y1 = yFor(prevItem.spent);
                    const x2 = xFor(idx);
                    const y2 = yFor(item.spent);

                    const edgeOffset = Math.min(barWidth * 0.38, (x2 - x1) * 0.24);
                    const startX = x1 + edgeOffset;
                    const endX = x2 - edgeOffset;
                    if (endX <= startX + 8) return null;

                    const startY = Math.min(baselineY - 6, y1 - 4);
                    const endY = Math.min(baselineY - 6, y2 - 4);
                    const midX = (startX + endX) / 2;
                    const curveLift = Math.min(22, Math.max(10, Math.abs(endY - startY) * 0.25 + 10));
                    const ctrlY = Math.max(14, Math.min(startY, endY) - curveLift);

                    const diff = item.spent - prevItem.spent;
                    const strokeColor = diff < 0 ? "#059669" : diff > 0 ? "#dc2626" : "#94a3b8";
                    const markerId =
                      diff < 0 ? `${uid}-arrow-down` : diff > 0 ? `${uid}-arrow-up` : `${uid}-arrow-flat`;

                    return (
                      <g key={`arrow-${item.month}`} pointerEvents="none">
                        <path
                          d={`M ${startX},${startY} Q ${midX},${ctrlY} ${endX},${endY}`}
                          fill="none"
                          stroke={strokeColor}
                          strokeWidth="1.6"
                          strokeDasharray={diff === 0 ? "3 3" : undefined}
                          markerEnd={`url(#${markerId})`}
                          opacity="0.88"
                        />
                      </g>
                    );
                  })}

                {/* Her Barın / Noktanın Üzerindeki Rakam Etiketi */}
                {monthlyPoints.map((item, idx) => {
                  const cx = xFor(idx);
                  const topY = yFor(item.spent);
                  const labelY = Math.max(15, topY - 10);
                  const isCurrent = item.month === month;
                  return (
                    <g key={`label-${item.month}`} pointerEvents="none">
                      <text
                        x={cx}
                        y={labelY}
                        textAnchor="middle"
                        className={`trend-bar-value ${isCurrent ? "current" : ""}`}
                      >
                        {barMoney(item.spent, dense)}
                      </text>
                    </g>
                  );
                })}
              </>
            )}

            {/* 2. AYRI AYRI KIYASLA GÖRÜNÜMÜ (Çoklu Kategori Seçildiğinde) */}
            {showSplitSeries && (
              <>
                {selectedIds.map((selId, sIdx) => {
                  const color = seriesColors[sIdx % seriesColors.length];
                  const coords = monthlyPoints
                    .map((p, idx) => `${xFor(idx)},${yFor(p.seriesValues[sIdx] ?? 0)}`)
                    .join(" L ");
                  const subBarW = Math.max(4, Math.min(22, (slotWidth * 0.68) / selectedIds.length));

                  return (
                    <g key={selId}>
                      {chartMode !== "bar" ? (
                        <>
                          <path
                            d={`M ${coords}`}
                            fill="none"
                            stroke={color}
                            strokeWidth="2.4"
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                          {monthlyPoints.map((item, idx) => (
                            <circle
                              key={`${selId}-${item.month}`}
                              cx={xFor(idx)}
                              cy={yFor(item.seriesValues[sIdx] ?? 0)}
                              r={hoverIndex === idx ? 5.5 : 3.8}
                              fill={color}
                              stroke="#ffffff"
                              strokeWidth="1.8"
                              onPointerEnter={() => setHoverIndex(idx)}
                              style={{ cursor: "pointer" }}
                            />
                          ))}
                        </>
                      ) : (
                        monthlyPoints.map((item, idx) => {
                          const val = item.seriesValues[sIdx] ?? 0;
                          const topY = yFor(val);
                          const barH = Math.max(2, baselineY - topY);
                          const xPos = xFor(idx) + (sIdx - selectedIds.length / 2) * subBarW;
                          return (
                            <g
                              key={`${selId}-${item.month}`}
                              onPointerEnter={() => setHoverIndex(idx)}
                              style={{ cursor: "pointer" }}
                            >
                              <rect
                                x={xPos}
                                y={topY}
                                width={Math.max(3, subBarW - 2)}
                                height={barH}
                                rx="3"
                                fill={color}
                                opacity={hoverIndex === null || hoverIndex === idx ? 1 : 0.6}
                              />
                              {val > 0 && selectedIds.length <= 3 && (
                                <text
                                  x={xPos + (subBarW - 2) / 2}
                                  y={Math.max(14, topY - 6)}
                                  textAnchor="middle"
                                  className="trend-bar-value"
                                  style={{ fontSize: "9px", fill: color }}
                                >
                                  {barMoney(val, true)}
                                </text>
                              )}
                            </g>
                          );
                        })
                      )}
                    </g>
                  );
                })}
              </>
            )}

            {/* X Ekseni Ay İsimleri */}
            {monthlyPoints.map((item, idx) => {
              const showLabel = count <= 14 || idx % Math.ceil(count / 12) === 0 || idx === count - 1;
              if (!showLabel) return null;
              return (
                <text
                  key={`x-${item.month}`}
                  x={xFor(idx)}
                  y={height - 14}
                  textAnchor="middle"
                  className={`trend-axis-text ${item.month === month ? "current" : ""}`}
                >
                  {item.label}
                </text>
              );
            })}
          </svg>

          {activePoint && hoverIndex !== null && (
            <div
              className="chart-tooltip"
              role="status"
              style={{
                left: Math.max(8, Math.min(width - 235, xFor(hoverIndex) - 110)),
                top: 6,
              }}
            >
              <strong>
                {activePoint.label} · {selectedLabel}
              </strong>
              {showSplitSeries ? (
                selectedIds.map((selId, sIdx) => (
                  <span key={selId}>
                    <i style={{ background: seriesColors[sIdx % seriesColors.length] }} />
                    {categoryLabel(data.categories, selId)}
                    <b>{money(activePoint.seriesValues[sIdx] ?? 0)}</b>
                  </span>
                ))
              ) : (
                <span>
                  <i style={{ background: "#059669" }} />
                  Toplam Harcama
                  <b>{money(activePoint.spent)}</b>
                </span>
              )}
              {activePoint.diff !== null && (
                <span>
                  Önceki aya göre
                  <b style={{ color: activePoint.diff <= 0 ? "#059669" : "#dc2626" }}>
                    {activePoint.diff > 0 ? "+" : ""}
                    {money(activePoint.diff)}
                    {activePoint.pct !== null
                      ? ` (${activePoint.diff <= 0 ? "↓" : "↑"}%${Math.abs(activePoint.pct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })})`
                      : ""}
                  </b>
                </span>
              )}
              <small>{activePoint.count} işlem</small>
            </div>
          )}
        </div>
      </div>

      {/* Ay Ay Değişim Şeridi */}
      <div className="trend-monthly-cards-wrap">
        <div className="trend-monthly-cards-header">
          <span>Ay Ay Harcama ve Önceki Aya Göre Değişim ({selectedLabel})</span>
          <small>Yeşil (↓): önceki aya göre azalma · Kırmızı (↑): önceki aya göre artış</small>
        </div>
        <div className="trend-monthly-cards">
          {monthlyPoints.map(item => {
            const isCurrent = item.month === month;
            const isDown = item.diff !== null && item.diff < 0;
            const isUp = item.diff !== null && item.diff > 0;
            return (
              <div
                key={item.month}
                className={`trend-month-card ${isCurrent ? "current" : ""} ${isDown ? "reduced" : isUp ? "increased" : ""}`}
              >
                <span className="trend-month-name">{item.label}</span>
                <strong className="trend-month-amount">{money(item.spent)}</strong>
                {item.diff === null || (item.prev === 0 && item.spent === 0) ? (
                  <span className="trend-month-delta neutral">—</span>
                ) : item.diff === 0 ? (
                  <span className="trend-month-delta neutral">Aynı</span>
                ) : (
                  <span
                    className={`trend-month-delta ${isDown ? "down" : "up"}`}
                    title={`Önceki aya göre: ${item.diff > 0 ? "+" : ""}${money(item.diff)}`}
                  >
                    {isDown ? "↓" : "↑"}{" "}
                    {item.pct !== null
                      ? `%${Math.abs(item.pct).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`
                      : money(Math.abs(item.diff))}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
