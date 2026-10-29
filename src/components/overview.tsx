"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowUpRight, ArrowUpRightFromSquare, Award, ChevronRight, CreditCard, Flame, Layers, ReceiptText, Store, TrendingDown, TrendingUp, Wallet, X } from "lucide-react";
import type { AppData } from "@/lib/types";
import { buildAnalytics } from "@/lib/analytics";
import { categoryLabel } from "@/lib/categories";
import CategoryAnalysis from "./category-analysis";
import CategoryPicker from "./category-picker";
import CategoryTrendTracker from "./category-trend-tracker";
import MonthlyComparison from "./monthly-comparison";
import SpendingRhythm from "./spending-rhythm";

const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(value / 100);
const colors = ["#059669", "#2563eb", "#0891b2", "#7c3aed", "#d97706", "#db2777", "#4f46e5", "#0d9488", "#e11d48", "#64748b"];
const monthLabel = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });

export type AtlasFilters = { category: string; cardId: string; date: string; merchant: string };

export default function Overview({ data, month, onMonth, onExplore }: { data: AppData; month: string; onMonth: (month: string) => void; onExplore: (filters: AtlasFilters) => void }) {
  const [category, setCategory] = useState("");
  const [card, setCard] = useState("");
  const [merchant, setMerchant] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { setMerchant(""); }, [month]);

  const baseExpenses = data.expenses.filter(row => !card || row.cardId === card);
  const base = buildAnalytics(baseExpenses, data.cards, data.categories, month);

  const selectedCategory = data.categories.find(item => item.id === category);
  const selectedRoot = selectedCategory?.parentId ?? selectedCategory?.id ?? "";

  const expenses = baseExpenses.filter(row => !selectedCategory || row.category === category || data.categories.find(item => item.id === row.category)?.parentId === category);
  const report = buildAnalytics(expenses, data.cards, data.categories, month);

  const movements = report.monthly
    .filter(row => row.kind === "expense" && (!merchant || row.merchant.toLocaleLowerCase("tr").includes(merchant.toLocaleLowerCase("tr"))))
    .sort((a, b) => b.date.localeCompare(a.date));

  const rootCategories = base.categoryComparison;
  const maxCategoryAmount = Math.max(1, ...rootCategories.map(c => c.amount));
  const categoryColor = (id: string) => colors[Math.max(0, data.categories.filter(item => item.parentId === null).findIndex(item => item.id === id)) % colors.length];

  const activeRootComparison = base.categoryComparison.find(c => c.id === selectedRoot);
  const detail = data.expenses.find(row => row.id === expanded);

  const topCategory = rootCategories.find(c => c.amount > 0);
  const biggestRise = [...rootCategories].filter(c => c.diff > 0 && c.prevAmount > 0).sort((a, b) => b.diff - a.diff)[0] ?? null;
  const topExpense = report.topExpenses[0] ?? null;
  const topMerchant = report.merchantDetails[0] ?? null;

  function selectCategory(id: string) {
    setCategory(current => current === id ? "" : id);
    setMerchant("");
  }

  function clearAllFilters() {
    setCard("");
    setCategory("");
    setMerchant("");
  }

  const hasActiveFilters = Boolean(card || category || merchant);

  const renderBadge = (pct: number | null, diff?: number) => {
    if (pct === null) {
      if (diff && diff > 0) return <span className="fintech-badge neutral">Yeni</span>;
      return <span className="fintech-badge neutral">Önceki ay yok</span>;
    }
    const isDown = pct < 0;
    const isZero = Math.abs(pct) < 0.1;
    if (isZero) return <span className="fintech-badge neutral">Değişim yok</span>;
    return (
      <span className={`fintech-badge ${isDown ? "down" : "up"}`} title={diff !== undefined ? `Geçen aya göre fark: ${diff > 0 ? "+" : ""}${money(diff)}` : undefined}>
        {isDown ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
        %{Math.abs(pct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
      </span>
    );
  };

  return <div className="atlas-overview fintech-overview">
    {/* 1. ZARİF, KOMPAKT KART & KATEGORİ SEÇİM ÇUBUĞU */}
    <div className="fintech-toolbar" aria-label="Genel bakış filtreleri">
      <div className="fintech-card-pills" role="group" aria-label="Kart seçimi">
        <button
          type="button"
          className={`card-pill-btn ${card === "" ? "active" : ""}`}
          aria-pressed={card === ""}
          onClick={() => { setCard(""); setMerchant(""); }}
        >
          <CreditCard size={14} />
          <span>Tüm Kartlar</span>
        </button>
        {data.cards.map(item => {
          const cardStat = base.cards.find(c => c.id === item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`card-pill-btn ${card === item.id ? "active" : ""}`}
              aria-pressed={card === item.id}
              onClick={() => { setCard(card === item.id ? "" : item.id); setMerchant(""); }}
            >
              <span>{item.name} · {item.lastFour}</span>
              {cardStat && cardStat.spent > 0 && <strong>{money(cardStat.spent)}</strong>}
            </button>
          );
        })}
      </div>

      <div className="fintech-toolbar-right">
        <CategoryPicker
          label="Genel bakış kategori filtresi"
          placeholder="Kategori filtrele…"
          categories={data.categories}
          value={category}
          onChange={id => { setCategory(id); setMerchant(""); }}
        />
        {hasActiveFilters && (
          <button type="button" className="atlas-clear" onClick={clearAllFilters}>
            <X size={13} /> Filtreleri sıfırla
          </button>
        )}
      </div>
    </div>

    {/* 2. ANLAMLI ÖZET KARTLARI (4 KART) */}
    <div className="fintech-kpi-grid">
      <section className="fintech-kpi-card primary-kpi">
        <div className="kpi-header">
          <span className="kpi-title"><Wallet size={15} /> AYLIK TOPLAM HARCAMA</span>
          {renderBadge(report.spentChange, report.spent - report.previous.spent)}
        </div>
        <div className="kpi-value" aria-live="polite">{money(report.spent)}</div>
        <div className="kpi-footer">
          <span>Geçen ay: <strong>{money(report.previous.spent)}</strong></span>
          <span>·</span>
          <span>{selectedCategory?.name ?? "Tüm kategoriler"}</span>
        </div>
      </section>

      <section className="fintech-kpi-card">
        <div className="kpi-header">
          <span className="kpi-title"><Award size={15} /> LİDER KATEGORİ</span>
          {topCategory && <span className="fintech-badge neutral">%{topCategory.share.toFixed(1)} pay</span>}
        </div>
        {topCategory ? (
          <>
            <div className="kpi-value kpi-text-value" onClick={() => selectCategory(topCategory.id)} role="button" tabIndex={0}>
              <span>{topCategory.name}</span>
              <strong>{money(topCategory.amount)}</strong>
            </div>
            <div className="kpi-footer">
              <span>Geçen ay: <strong>{money(topCategory.prevAmount)}</strong></span>
              <span>·</span>
              <span>{topCategory.count} işlem</span>
            </div>
          </>
        ) : (
          <>
            <div className="kpi-value">—</div>
            <div className="kpi-footer"><span>Bu ayda harcama kaydı yok</span></div>
          </>
        )}
      </section>

      <section className="fintech-kpi-card">
        <div className="kpi-header">
          <span className="kpi-title"><Flame size={15} /> EN ÇOK ARTAN ALAN</span>
          {biggestRise && renderBadge(biggestRise.pctChange, biggestRise.diff)}
        </div>
        {biggestRise ? (
          <>
            <div className="kpi-value kpi-text-value" onClick={() => selectCategory(biggestRise.id)} role="button" tabIndex={0}>
              <span>{biggestRise.name}</span>
              <strong>+{money(biggestRise.diff)}</strong>
            </div>
            <div className="kpi-footer">
              <span>{money(biggestRise.prevAmount)} → <strong>{money(biggestRise.amount)}</strong></span>
            </div>
          </>
        ) : (
          <>
            <div className="kpi-value kpi-text-value">
              <span>Artış Yok</span>
              <strong>{money(0)}</strong>
            </div>
            <div className="kpi-footer"><span>Geçen aya göre artan kategori yok</span></div>
          </>
        )}
      </section>

      <section className="fintech-kpi-card">
        <div className="kpi-header">
          <span className="kpi-title"><ArrowUpRight size={15} /> EN BÜYÜK TEKİL HARCAMA</span>
          {topExpense && <span className="fintech-badge neutral">{dateLabel(topExpense.date)}</span>}
        </div>
        {topExpense ? (
          <>
            <div className="kpi-value kpi-text-value" onClick={() => setExpanded(topExpense.id)} role="button" tabIndex={0}>
              <span>{topExpense.merchant}</span>
              <strong>{money(topExpense.amount)}</strong>
            </div>
            <div className="kpi-footer">
              <span>{categoryLabel(data.categories, topExpense.category)}</span>
              {topMerchant && <><span>·</span><span>Lider iş yeri: <strong>{topMerchant.name}</strong></span></>}
            </div>
          </>
        ) : (
          <>
            <div className="kpi-value">—</div>
            <div className="kpi-footer"><span>Kayıtlı işlem bulunmuyor</span></div>
          </>
        )}
      </section>
    </div>

    {/* 3. ANA ANALİTİK WORKBENCH: SOLDA HARCAMA ALANLARI VE DEĞİŞİM, SAĞDA İŞLEM DÖKÜMÜ (BU AYIN HARCAMALARI) */}
    <div className="fintech-workbench">
      {/* SOL PANEL: HARCAMA ALANLARI VE DEĞİŞİM */}
      <section className="panel fintech-category-panel">
        <div className="panel-heading">
          <div>
            <span className="atlas-kicker"><Layers size={13} /> KATEGORİ & ALT KATEGORİ ANALİZİ</span>
            <h2>Harcama Alanları ve Değişim</h2>
            <p>Soldan bir kategori veya alt kategori seçtiğinde sağdaki işlem dökümü anında filtrelenir.</p>
          </div>
          {selectedCategory && (
            <button type="button" className="atlas-clear" onClick={() => setCategory("")}>
              <X size={13} /> Seçimi kaldır
            </button>
          )}
        </div>

        <div className="fintech-category-list" role="region" aria-label="Kategori harcama sıralaması">
          {rootCategories.filter(item => item.amount > 0 || item.prevAmount > 0 || selectedRoot === item.id).map(item => {
            const isSelected = selectedRoot === item.id;
            const color = categoryColor(item.id);
            const barWidth = item.amount > 0 ? Math.max(2, item.amount / maxCategoryAmount * 100) : 0;

            return (
              <div key={item.id} className={`fintech-cat-group ${isSelected ? "selected" : ""}`} style={{ "--cat-color": color } as CSSProperties}>
                <button
                  type="button"
                  className="fintech-cat-row"
                  aria-pressed={isSelected}
                  onClick={() => selectCategory(item.id)}
                >
                  <div className="fintech-cat-main">
                    <div className="fintech-cat-title">
                      <span className="cat-dot" style={{ background: color }} />
                      <strong>{item.name}</strong>
                      <span className="cat-count">{item.count} işlem</span>
                    </div>
                    <div className="fintech-cat-metrics">
                      <span className="cat-share">%{item.share.toFixed(1)} pay</span>
                      {renderBadge(item.pctChange, item.diff)}
                      <strong className="cat-amount">{money(item.amount)}</strong>
                      <ChevronRight size={15} className={`cat-chevron ${isSelected ? "rotated" : ""}`} />
                    </div>
                  </div>
                  <div className="fintech-cat-bar-track">
                    <div className="fintech-cat-bar-fill" style={{ width: `${barWidth}%`, background: color }} />
                  </div>
                </button>

                {/* Alt Kategoriler Drill-down */}
                {isSelected && activeRootComparison && activeRootComparison.children.length > 0 && (
                  <div className="fintech-subcat-drawer" aria-label={`${item.name} alt kategorileri`}>
                    <div className="subcat-drawer-header">
                      <span>Alt Kategori Kırılımı</span>
                      <span>Önceki Ay / Bu Ay</span>
                    </div>
                    {activeRootComparison.children.map(sub => {
                      const subSelected = category === sub.id;
                      const subShare = item.amount > 0 ? sub.amount / item.amount * 100 : 0;
                      const subPct = sub.prevAmount > 0 ? (sub.amount - sub.prevAmount) / sub.prevAmount * 100 : null;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          className={`fintech-subcat-row ${subSelected ? "active" : ""}`}
                          aria-pressed={subSelected}
                          onClick={() => selectCategory(sub.id)}
                        >
                          <div className="subcat-info">
                            <span className="subcat-name">{sub.name}</span>
                            <small>{sub.count} işlem · Kategori içi %{subShare.toFixed(0)}</small>
                          </div>
                          <div className="subcat-values">
                            <small className="subcat-prev">Önceki: {money(sub.prevAmount)}</small>
                            {renderBadge(subPct)}
                            <strong>{money(sub.amount)}</strong>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {!rootCategories.some(item => item.amount > 0 || item.prevAmount > 0) && (
            <div className="table-empty">Bu dönemde kayıtlı kategori harcaması bulunmuyor.</div>
          )}
        </div>
      </section>

      {/* SAĞ PANEL: İŞLEM DÖKÜMÜ — BU AYIN HARCAMALARI */}
      <section className="panel atlas-movements workbench-movements">
        <div className="panel-heading">
          <div>
            <span className="atlas-kicker"><ReceiptText size={13} /> İŞLEM DÖKÜMÜ</span>
            <h2>{selectedCategory ? `${selectedCategory.name} Harcamaları` : "Bu Ayın Harcamaları"}</h2>
            <p aria-live="polite">
              {movements.length} harcama · Toplam <strong>{money(movements.reduce((sum, item) => sum + item.amount, 0))}</strong>
              {merchant ? ` · ${merchant}` : ""}
            </p>
          </div>
          <button className="secondary" onClick={() => onExplore({ category, cardId: card, date: "", merchant })}>
            Tüm işlemler ekranında aç <ArrowUpRightFromSquare size={14} />
          </button>
        </div>
        <div className="atlas-movement-filters">
          <input aria-label="Atlas iş yeri ara" placeholder="İş yeri veya açıklama ara…" value={merchant} onChange={event => setMerchant(event.target.value)} />
          {selectedCategory && (
            <button type="button" className="atlas-clear" onClick={() => setCategory("")}>
              {selectedCategory.name} <X size={14} />
            </button>
          )}
          {merchant && <button type="button" className="atlas-clear" onClick={() => setMerchant("")}>Aramayı temizle <X size={14} /></button>}
        </div>
        <div className="table-wrap workbench-table-wrap">
          <table>
            <thead>
              <tr>
                <th>İş yeri</th>
                <th>Tarih</th>
                <th>Kategori</th>
                <th className="amount">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(item => (
                <tr key={item.id}>
                  <td>
                    <button className="atlas-transaction-button" onClick={() => setExpanded(item.id)}>
                      <span className="merchant-avatar">{item.merchant[0]}</span>
                      <strong>{item.merchant}</strong>
                      <ChevronRight size={14} />
                    </button>
                  </td>
                  <td>{dateLabel(item.date)}</td>
                  <td>
                    <span className="category-chip">{categoryLabel(data.categories, item.category)}</span>
                  </td>
                  <td className="amount">
                    {money(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!movements.length && <div className="table-empty">Bu seçimle eşleşen hareket yok. Filtreleri değiştirerek devam edebilirsin.</div>}
      </section>
    </div>

    {/* 4. 12 AYLIK HARCAMA RİTMİ VE EN ÇOK HARCANAN İŞ YERLERİ */}
    <div className="atlas-charts-grid">
      <SpendingRhythm data={data} month={month} card={card} category={category} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="atlas-kicker"><Store size={13} /> ÖNE ÇIKAN NOKTALAR</span>
            <h2>En Çok Harcanan İş Yerleri</h2>
            <p>Bir iş yerine tıklayarak yukarıdaki işlem dökümünü o iş yerine göre süz.</p>
          </div>
          {merchant && (
            <button type="button" className="atlas-clear" onClick={() => setMerchant("")}>
              {merchant} <X size={13} />
            </button>
          )}
        </div>
        <div className="atlas-merchants">
          {report.merchantDetails.slice(0, 6).map((item, index) => (
            <button
              type="button"
              key={item.name}
              aria-pressed={merchant === item.name}
              onClick={() => setMerchant(merchant === item.name ? "" : item.name)}
            >
              <span className="atlas-merchant-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="atlas-merchant-name">
                <span className="merchant-name-row">
                  <strong>{item.name}</strong>
                  <small>{item.count} işlem</small>
                </span>
                <i><b style={{ width: `${item.amount / Math.max(1, report.merchantDetails[0].amount) * 100}%`, background: colors[index % colors.length] }} /></i>
              </span>
              <strong>{money(item.amount)}</strong>
              <ChevronRight size={15} />
            </button>
          ))}
          {!report.merchantDetails.length && <div className="table-empty">Bu seçim için harcama yok.</div>}
        </div>
      </section>
    </div>

    {/* 5. AYLAR ARASI KARŞILAŞTIRMA MATRİSİ (TÜM KATEGORİLER, SCROLL YOK) */}
    <MonthlyComparison data={data} month={month} card={card} category={category} onMonth={onMonth} onCategory={id => setCategory(id)} />

    {/* 6. ANA KATEGORİ & ALT KATEGORİ AYLIK DEĞİŞİM VE AZALTMA TAKİBİ GRAFİĞİ */}
    <CategoryTrendTracker data={data} month={month} card={card} externalCategory={category} />

    {/* 7. ÖZEL DÖNEM ARALIĞI SORGULAMA (DRAWER) */}
    <details className="advanced-analysis">
      <summary>Özel Tarih Aralığı & Derin Kategori Sorgulama <span>İki ay arasındaki toplamları ve alt kırılımları kıyasla</span></summary>
      <CategoryAnalysis data={{ ...data, expenses: baseExpenses }} month={month} selectedCategory={category} onCategory={id => { setCategory(id); setMerchant(""); }} />
    </details>

    {/* İŞLEM DETAY MODALI */}
    {detail && (
      <div className="modal-backdrop" onClick={() => setExpanded(null)}>
        <section
          className="modal atlas-transaction-detail"
          role="dialog"
          aria-modal="true"
          aria-labelledby="atlas-detail-title"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === "Escape") setExpanded(null); }}
        >
          <div className="panel-heading">
            <h2 id="atlas-detail-title">İşlem ayrıntısı</h2>
            <button autoFocus aria-label="Ayrıntıyı kapat" onClick={() => setExpanded(null)}><X size={20} /></button>
          </div>
          <div className="atlas-detail-body">
            <span className="merchant-avatar">{detail.merchant[0]}</span>
            <h3>{detail.merchant}</h3>
            <strong>{money(detail.amount)}</strong>
            <dl>
              <dt>İşlem tarihi</dt><dd>{dateLabel(detail.date)}</dd>
              <dt>Ekstre ayı</dt><dd>{detail.reportingMonth ? monthLabel(detail.reportingMonth) : monthLabel(detail.date.slice(0, 7))}</dd>
              <dt>Kategori</dt><dd>{categoryLabel(data.categories, detail.category)}</dd>
              <dt>Kart</dt><dd>{data.cards.find(item => item.id === detail.cardId)?.name}</dd>
            </dl>
            <button className="primary" onClick={() => { setExpanded(null); onExplore({ category: detail.category, cardId: detail.cardId, date: detail.date, merchant: detail.merchant }); }}>
              İşlemler ekranında aç <ArrowUpRightFromSquare size={14} />
            </button>
          </div>
        </section>
      </div>
    )}
  </div>;
}
