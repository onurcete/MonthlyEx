"use client";
import { useEffect, useId, useRef, useState } from "react";

export type ChartPoint = { key: string; label: string; values: number[] };
export type ChartSeries = { name: string; color: string };
const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value / 100);
const compact = (value: number) => new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 }).format(value / 100);

export default function InteractiveChart({ points, series, title, onSelect, selectedKey, defaultMode = "area" }: {
  points: ChartPoint[]; series: ChartSeries[]; title: string; onSelect?: (key: string) => void; selectedKey?: string; defaultMode?: "area" | "bar" | "line";
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState(defaultMode);
  const [hidden, setHidden] = useState<number[]>([]);
  const uid = useId().replace(/:/g, "");
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const height = 270, left = 58, right = 18, top = 24, bottom = 42;
  const chartWidth = width - left - right, chartHeight = height - top - bottom;
  const shown = series.map((_, index) => index).filter(index => !hidden.includes(index));
  const values = points.flatMap(point => shown.map(index => point.values[index] ?? 0));
  const minimum = values.reduce((result, value) => Math.min(result, value), 0), maximum = values.reduce((result, value) => Math.max(result, value), 1);
  const span = maximum - minimum;
  const low = minimum < 0 ? minimum - span * .12 : 0;
  const high = maximum + span * .14;
  const y = (value: number) => top + (high - value) / (high - low) * chartHeight;
  const x = (index: number) => left + chartWidth * (index + .5) / Math.max(1, points.length);
  const active = hover === null ? -1 : Math.min(hover, points.length - 1);
  const point = points[active];
  const step = Math.max(1, Math.ceil(points.length / Math.max(3, Math.floor(chartWidth / 76))));
  return <div className="interactive-chart" ref={host}>
    <div className="interactive-chart-tools"><div className="interactive-legend">{series.map((item, index) => <button key={`${item.name}-${index}`} type="button" aria-pressed={!hidden.includes(index)} onClick={() => setHidden(current => current.includes(index) ? current.filter(value => value !== index) : [...current, index])}><i style={{ background: item.color }}/><span>{item.name}</span></button>)}</div><div className="segmented-control" aria-label={`${title} grafik görünümü`}><button type="button" aria-pressed={mode === "line"} onClick={() => setMode("line")}>Çizgi</button>{series.length <= 2 && <button type="button" aria-pressed={mode === "area"} onClick={() => setMode("area")}>Alan</button>}<button type="button" aria-pressed={mode === "bar"} onClick={() => setMode("bar")}>Sütun</button></div></div>
    <div className="interactive-chart-canvas">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${title}. Ok tuşlarıyla gezin${onSelect ? ", Enter ile ayrıntıya geçin" : ""}.`} tabIndex={0}
        onFocus={() => setHover(0)} onBlur={() => setHover(null)} onKeyDown={event => {
          if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) { event.preventDefault(); setHover(event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, active + (event.key === "ArrowRight" ? 1 : -1)))); }
          if (event.key === "Enter" && point) onSelect?.(point.key);
        }} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * width; setHover(Math.max(0, Math.min(points.length - 1, Math.floor((px - left) / chartWidth * points.length)))); }} onPointerLeave={() => setHover(null)} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); const px = (event.clientX - rect.left) / rect.width * width; const index = Math.max(0, Math.min(points.length - 1, Math.floor((px - left) / chartWidth * points.length))); setHover(index); if (points[index]) onSelect?.(points[index].key); }}>
        <defs>{series.map((item, index) => <linearGradient key={item.name} id={`${uid}-${index}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity=".28"/><stop offset="100%" stopColor={item.color} stopOpacity=".015"/></linearGradient>)}</defs>
        {[0, 1, 2, 3].map(tick => { const value = low + (high - low) * tick / 3; return <g key={tick}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-gridline"/><text x={left - 10} y={y(value) + 4} textAnchor="end">{compact(value)}</text></g>; })}
        <text x={left} y="12" className="chart-unit">TL</text>
        {low < 0 && <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="chart-zero"/>}
        {shown.map((seriesIndex, order) => {
          const coordinates = points.map((item, index) => `${x(index)},${y(item.values[seriesIndex] ?? 0)}`).join(" L ");
          const barWidth = Math.max(1, Math.min(30, chartWidth / Math.max(1, points.length) * .66 / Math.max(1, shown.length)));
          return <g key={seriesIndex} className="chart-data">
            {mode !== "bar" && points.length > 0 ? <>{mode === "area" && <path d={`M ${x(0)},${y(0)} L ${coordinates} L ${x(points.length - 1)},${y(0)} Z`} fill={`url(#${uid}-${seriesIndex})`}/>}<path d={`M ${coordinates}`} fill="none" stroke={series[seriesIndex].color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>{points.map((item, index) => <circle key={item.key} cx={x(index)} cy={y(item.values[seriesIndex] ?? 0)} r={active === index || selectedKey === item.key ? 5 : points.length < 15 ? 3 : 0} fill={series[seriesIndex].color} stroke="white" strokeWidth="2"/>)}</> : points.map((item, index) => { const value = item.values[seriesIndex] ?? 0; return <rect key={item.key} x={x(index) + (order - shown.length / 2) * barWidth} y={Math.min(y(value), y(0))} width={Math.max(.5, barWidth - 2)} height={Math.abs(y(value) - y(0))} rx="3" fill={series[seriesIndex].color} opacity={active === -1 || active === index ? 1 : .45}/>; })}
          </g>;
        })}
        {points.map((item, index) => ((index % step === 0 && index < points.length - Math.ceil(step * .75)) || index === points.length - 1) && <text key={item.key} x={x(index)} y={height - 15} textAnchor={index === points.length - 1 ? "end" : index === 0 ? "start" : "middle"}>{item.label}</text>)}
        {point && <g pointerEvents="none"><line x1={x(active)} x2={x(active)} y1={top} y2={height - bottom} className="chart-crosshair"/>{shown.map(index => <circle key={index} cx={x(active)} cy={y(point.values[index] ?? 0)} r="5" fill={series[index].color} stroke="white" strokeWidth="2"/>)}</g>}
      </svg>
      {point && <div className="chart-tooltip" role="status" style={{ left: Math.max(4, Math.min(width - 224, x(active) - 110)), top: 4 }}><strong>{point.label}</strong>{shown.map(index => <span key={index}><i style={{ background: series[index].color }}/>{series[index].name}<b>{money(point.values[index] ?? 0)}</b></span>)}{onSelect && <small>Ayrıntı için tıkla / Enter</small>}</div>}
    </div>
    {!points.length && <p className="chart-note">Bu seçim için veri bulunmuyor.</p>}
    <details className="chart-table"><summary>Grafik verilerini tablo olarak gör</summary><div className="table-wrap"><table><thead><tr><th>Dönem</th>{series.map(item => <th key={item.name}>{item.name}</th>)}</tr></thead><tbody>{points.map(item => <tr key={item.key}><td>{onSelect ? <button type="button" onClick={() => onSelect(item.key)}>{item.label} ↗</button> : item.label}</td>{series.map((_, index) => <td key={index}>{money(item.values[index] ?? 0)}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
