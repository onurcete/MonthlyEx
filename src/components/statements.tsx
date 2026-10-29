"use client";

import { useState, type FormEvent } from "react";
import { AlertCircle, CheckCheck, FileText, Layers, Plus, RotateCcw, Search, Sparkles, Trash2, Upload, X } from "lucide-react";
import type { Card, Statement, Category, Expense } from "@/lib/types";
import { categoryLabel, resolveCategory } from "@/lib/categories";
import CategoryPicker from "./category-picker";
import type { Analysis, AnalysisRow } from "@/lib/analysis-schema";
import { statementMonthFromAnalysis } from "@/lib/reporting-period";
import type { CategoryLearning } from "@/lib/merchant";
import { similarStatementMerchant, statementCategoryTargets } from "@/lib/statement-category";
import { isStatementRowIncluded, sortedStatementRows, type StatementSort } from "@/lib/statement-review";

const money = (amount: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount / 100);
const labels: Record<string, string> = { pending: "Analiz bekliyor", analyzing: "Analiz sürüyor", review: "İncelemeye hazır", imported: "Aktarıldı", failed: "Analiz başarısız" };
const kinds = { expense: "Harcama", refund: "İade", payment: "Kart ödemesi", fee: "Ücret / vergi", interest: "Faiz" };
type EditableRow = AnalysisRow & { id?: string; selected: boolean; deleted?: boolean; amountText: string; rememberCategory?: boolean; learning?: CategoryLearning };
type Props = { statements: Statement[]; cards: Card[]; categories: Category[]; expenses?: Expense[]; aiConfigured: boolean; onRefresh: (preferredMonth?: string) => Promise<void>; onMessage: (message: string) => void };

export default function Statements({ statements, cards, categories, expenses = [], aiConfigured, onRefresh, onMessage }: Props) {
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [review, setReview] = useState<{ id: string; analysis: Analysis; imported: boolean; revision?: string } | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [cardId, setCardId] = useState("");
  const [reportMonth, setReportMonth] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [sort, setSort] = useState<StatementSort>("merchant-asc");
  const [batch, setBatch] = useState<number[]>([]);
  const [batchCategory, setBatchCategory] = useState("");
  const [editNotice, setEditNotice] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [categoryUndo, setCategoryUndo] = useState<{ index: number; category: string; rememberCategory?: boolean; learning?: CategoryLearning }[]>([]);
  const [historyPrompt, setHistoryPrompt] = useState<{ merchant: string; oldCategoryIds: string[]; newCategoryId: string; count: number } | null>(null);
  const [replaceHistoryQueue, setReplaceHistoryQueue] = useState<{ merchant: string; category: string }[]>([]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/statements", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await onRefresh(); form.reset(); setUploadName(""); onMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Dosya yüklenemedi."); }
    finally { setBusy(false); }
  }

  async function open(file: Statement, analyze: boolean) {
    setBusy(true); setActiveId(file.id); setError("");
    try {
      const response = await fetch(`/api/statements/${file.id}/analyze`, { method: analyze ? "POST" : "GET", cache: "no-store" });
      const analysis = await response.json();
      if (!response.ok) throw new Error(analysis.error);
      let source = analysis.rows;
      let revision: string | undefined;
      let savedCard: string | undefined;
      let savedMonth: string | null | undefined;
      if (file.status === "imported") {
        const savedResponse = await fetch(`/api/statements/${file.id}/transactions`, { cache: "no-store" });
        const saved = await savedResponse.json();
        if (!savedResponse.ok) throw new Error(saved.error);
        source = saved.rows; revision = saved.revision; savedCard = saved.cardId; savedMonth = saved.month;
      }
      setReview({ id: file.id, analysis, imported: file.status === "imported", revision });
      setQuery(""); setBatch([]); setOnlyReview(false); setCategoryUndo([]); setBatchCategory("");
      setHistoryPrompt(null); setReplaceHistoryQueue([]);
      setSort("merchant-asc");
      setEditNotice("");
      setRows(source.map((row: AnalysisRow & { id?: string; rememberCategory?: boolean; learning?: CategoryLearning }) => ({
        ...row,
        category: resolveCategory(categories, row.category)?.id ?? "",
        selected: file.status === "imported" || (row.kind !== "payment" && row.currency === "TRY" && !row.needsReview),
        rememberCategory: row.rememberCategory ?? (row.learning?.source === "learned" ? true : undefined),
        amountText: (row.amount / 100).toFixed(2).replace(".", ","),
      })));
      setCardId(savedCard ?? cards.find(card => card.lastFour === analysis.lastFour)?.id ?? (cards.length === 1 ? cards[0].id : ""));
      setReportMonth(savedMonth ?? file.month ?? statementMonthFromAnalysis(analysis) ?? "");
      await onRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Analiz açılamadı."); await onRefresh().catch(() => {}); }
    finally { setBusy(false); setActiveId(null); }
  }

  function change(index: number, patch: Partial<EditableRow>) {
    setEditNotice("Değişikliklerin hazır. Tamamladığında aşağıdan kaydet.");
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  function markDeleted(index: number, deleted: boolean) {
    change(index, { deleted });
    setBatch(current => current.filter(value => value !== index));
    setEditNotice(deleted ? review?.imported ? "İşlem silinecek olarak işaretlendi. Değişiklikleri kaydet dediğinde silinir; kategori hafızası korunur. Kaydetmeden önce Geri al ile vazgeçebilirsin." : "İşlem silinecek olarak işaretlendi; kayda ve toplamlara dahil edilmeyecek. Satırdaki Geri al ile geri getirebilirsin." : "Silme işareti kaldırıldı. İşlemin kayıt durumunu satırdan görebilirsin.");
  }

  function assignCategory(indices: number[], id: string) {
    const targets = statementCategoryTargets(rows, indices);
    setCategoryUndo(targets.map(index => ({ index, category: rows[index].category, rememberCategory: rows[index].rememberCategory, learning: rows[index].learning })));
    setRows(current => current.map((row, index) => targets.includes(index) ? { ...row, category: id, rememberCategory: true, learning: undefined } : row));
    setEditNotice(`${targets.length} satıra kategori uygulandı${targets.length > indices.length ? `; aynı / benzer iş yerlerine ait ${targets.length - indices.length} satır otomatik eşleştirildi` : ""}. Tamamladığında değişiklikleri kaydet.`);

    // Check if there are historical records in previous months with a different category for this merchant
    const primaryIndex = indices[0];
    const sampleRow = rows[primaryIndex];
    if (sampleRow && sampleRow.merchant.trim()) {
      const currentStatementRowIds = new Set(rows.map(r => r.id).filter(Boolean));
      const historicalDiffs = expenses.filter(exp => !currentStatementRowIds.has(exp.id) && similarStatementMerchant(sampleRow.merchant, exp.merchant) && exp.category !== id);
      const learnedPrevCats = sampleRow.learning?.learnedCategories?.filter(catId => catId !== id) ?? [];
      const diffCategoryIds = [...new Set([...historicalDiffs.map(exp => exp.category), ...learnedPrevCats])];

      if (diffCategoryIds.length > 0) {
        setHistoryPrompt({
          merchant: sampleRow.merchant,
          oldCategoryIds: diffCategoryIds,
          newCategoryId: id,
          count: Math.max(historicalDiffs.length, sampleRow.learning?.examples ?? 1),
        });
      } else {
        setHistoryPrompt(null);
      }
    }
  }

  function confirmHistoryReplace(replaceAll: boolean) {
    if (!historyPrompt) return;
    if (replaceAll) {
      setReplaceHistoryQueue(current => [
        ...current.filter(item => !similarStatementMerchant(item.merchant, historyPrompt.merchant)),
        { merchant: historyPrompt.merchant, category: historyPrompt.newCategoryId },
      ]);
      setEditNotice(`"${historyPrompt.merchant}" için önceki aylardaki kayıtlar da kaydedildiğinde "${categoryLabel(categories, historyPrompt.newCategoryId)}" olarak güncellenecek.`);
    } else {
      setReplaceHistoryQueue(current => current.filter(item => !similarStatementMerchant(item.merchant, historyPrompt.merchant)));
      setEditNotice(`Önceki aylardaki "${historyPrompt.merchant}" kayıtları olduğu gibi bırakılacak; yalnızca bu ekstredeki seçim kaydedilecek.`);
    }
    setHistoryPrompt(null);
  }

  function undoCategory() {
    setRows(current => current.map((row, index) => {
      const previous = categoryUndo.find(item => item.index === index);
      return previous ? { ...row, category: previous.category, rememberCategory: previous.rememberCategory, learning: previous.learning } : row;
    }));
    setCategoryUndo([]);
    setHistoryPrompt(null);
    setEditNotice("Son kategori ataması geri alındı. Tamamladığında değişiklikleri kaydet.");
  }

  function approveAllNeedsReview() {
    const indicesToApprove = visibleRows.filter(({ row }) => !row.deleted && row.currency === "TRY" && row.kind !== "payment" && (row.needsReview || !row.selected)).map(({ index }) => index);
    if (!indicesToApprove.length) return;
    setRows(current => current.map((row, index) => indicesToApprove.includes(index) ? { ...row, selected: true, needsReview: false } : row));
    setEditNotice(`${indicesToApprove.length} kontrol bekleyen işlem onaylandı ve kayda dahil edildi.`);
  }

  function addManualRow() {
    const defaultDate = review?.analysis.statementDate ?? (reportMonth ? `${reportMonth}-15` : new Date().toISOString().slice(0, 10));
    const defaultCategory = categories.find(c => c.id === "default-9")?.id ?? categories[0]?.id ?? "";
    const newRow: EditableRow = {
      date: defaultDate,
      merchant: "Yeni işlem",
      amount: 10000,
      amountText: "100,00",
      currency: "TRY",
      category: defaultCategory,
      kind: "expense",
      installment: null,
      page: 1,
      needsReview: false,
      selected: true,
      rememberCategory: true,
    };
    setRows(current => [newRow, ...current]);
    setEditNotice("Yeni satır eklendi. İş yeri, tarih, tutar ve kategoriyi düzenleyip aşağıdan kaydedebilirsin.");
  }

  async function remove(file: Statement) {
    if (!window.confirm(`${file.name} ve bu ekstreden aktarılan tüm işlemler silinecek. Öğrenilen iş yeri–kategori eşleştirmeleri korunacak. Devam edilsin mi?`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/statements/${file.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (review?.id === file.id) { setReview(null); setRows([]); }
      await onRefresh();
      onMessage(result.warning ?? `Ekstre ve bu ekstreye bağlı ${result.count} işlem silindi. Öğrenilen kategori eşleştirmeleri korundu.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Ekstre silinemedi."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!review) return;
    setBusy(true); setError("");
    try {
      if (!reportMonth) throw new Error("Ekstrenin ait olduğu ayı seçin.");
      const selected = rows.filter(isStatementRowIncluded).map(row => {
        const raw = row.amountText.trim().replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Tutarları 1250,50 biçiminde girin; binlik ayırıcı kullanmayın.");
        const inst = row.installment?.trim() || null;
        return { ...row, installment: inst, amount: Math.round(Number(raw) * 100) };
      });
      const deletedIds = review.imported ? rows.filter(row => row.deleted && row.id).map(row => row.id!) : [];
      const response = await fetch(`/api/statements/${review.id}/${review.imported ? "transactions" : "import"}`, {
        method: review.imported ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardId,
          month: reportMonth,
          rows: selected,
          revision: review.revision,
          deletedIds,
          replaceHistoryMerchants: replaceHistoryQueue,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const savedResponse = await fetch(`/api/statements/${review.id}/transactions`, { cache: "no-store" });
      const saved = await savedResponse.json();
      if (!savedResponse.ok) throw new Error("Kayıt tamamlandı. Güncel işlemleri görmek için sonucu kapatıp yeniden açın.");
      setReview(current => current ? { ...current, imported: true, revision: saved.revision } : null);
      setRows(saved.rows.map((row: AnalysisRow & { id: string; rememberCategory?: boolean }) => ({ ...row, selected: true, amountText: (row.amount / 100).toFixed(2).replace(".", ",") })));
      setBatch([]); setCategoryUndo([]); setHistoryPrompt(null); setReplaceHistoryQueue([]);
      setEditNotice("");
      await onRefresh(reportMonth);
      onMessage(`${result.count} işlem ${review.imported ? "güncellendi" : "kaydedildi"}.${result.deletedCount ? ` ${result.deletedCount} işlem silindi; kategori hafızası korundu.` : ""}${result.historyUpdatedCount ? ` Geçmiş aylardaki ${result.historyUpdatedCount} benzer işlem de yeni kategoriye güncellendi.` : ""} İşlemlerin tamamı ${reportMonth} ekstre ayına yazıldı.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Aktarım başarısız."); }
    finally { setBusy(false); }
  }

  const selectedCount = rows.filter(isStatementRowIncluded).length;
  const deletedCount = rows.filter(row => row.deleted).length;
  const visibleRows = sortedStatementRows(rows, query, onlyReview, sort);
  const editableIndices = visibleRows.filter(({ row }) => !row.deleted && row.kind !== "payment" && row.currency === "TRY").map(({ index }) => index);
  const unapprovedVisibleCount = visibleRows.filter(({ row }) => !row.deleted && row.currency === "TRY" && row.kind !== "payment" && (row.needsReview || !row.selected)).length;

  const includedRows = rows.filter(isStatementRowIncluded);
  const net = includedRows.reduce((sum, row) => {
    const value = Number(row.amountText.replace(",", "."));
    return sum + (Number.isFinite(value) ? Math.round(value * 100) * (row.kind === "refund" ? -1 : 1) : 0);
  }, 0);

  const installmentRows = includedRows.filter(row => row.kind !== "refund" && Boolean(row.installment && row.installment.trim()));
  const installmentTotal = installmentRows.reduce((sum, row) => {
    const value = Number(row.amountText.replace(",", "."));
    return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0);
  }, 0);

  return <>
    <section className="panel upload-panel">
      <div className="empty-icon"><Upload size={28}/></div><h2>Ekstreni AI ile analiz et.</h2>
      <p>PDF veya ekstre fotoğrafını yükle, ardından AI analizini başlat.</p>
      <form onSubmit={upload} className="statement-upload-form"><label>Ekstre dosyası<input required disabled={busy} name="file" aria-label="Ekstre dosyası" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) setUploadName(file.name.slice(0, 200)); }}/></label><label>Kayıt adı<input name="name" aria-label="Ekstre kayıt adı" disabled={busy} maxLength={200} value={uploadName} onChange={event => setUploadName(event.target.value)} placeholder="Örn. Axess · Ekim 2026"/></label><button className="primary" disabled={busy}>Dosyayı kaydet</button></form>
      <small>PDF, PNG, JPEG veya WebP · En fazla 20 MB</small>
      <details className="statement-help"><summary><Sparkles size={14}/> Analiz ve kategori öğrenimi nasıl çalışır?</summary><p>AI analizi belgeyi OpenAI API’ye gönderir; API kullanımı ücretlidir. İşlemler kontrol edip kaydettikten sonra harcama ekranına yansır. Değiştirdiğin kategoriler “Sonraki ekstreler için hatırla” seçiliyse kaydettikten sonra sonraki ekstrelerde (farklı şube veya POS kodu olsa bile) otomatik önerilir.</p></details>
      {!aiConfigured && <div className="analysis-note">API bağlantısı hazır değil. Projenin <code>.env.local</code> dosyasına <code>OPENAI_API_KEY</code> ekleyip geliştirme sunucusunu yeniden başlatın. Anahtarınızı sohbet alanına yazmayın.</div>}
    </section>
    {error && <div className="notice" role="alert">{error}<button aria-label="Hatayı kapat" onClick={() => setError("")}><X size={16}/></button></div>}
    <section className="panel">
      <div className="panel-heading"><h2>Yüklenen ekstreler</h2><span className="tag">{statements.length} belge</span></div>
      {statements.map(file => <div className="statement-row" key={file.id}>
        <FileText size={21}/>
        <div><strong>{file.name}</strong><small>{new Date(file.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</small><small>Ekstre ayı: {file.month ?? "Kayıt sırasında seçilecek"}</small>{file.error && <small role="status">{file.error}</small>}</div>
        <div className="statement-totals"><span>{file.status === "imported" ? "Kayıtlı net toplam" : "Ekstre borcu"}</span><strong>{typeof (file.status === "imported" ? file.netSpending : file.statementBalance) === "number" ? money((file.status === "imported" ? file.netSpending : file.statementBalance)!) : "—"}</strong>{file.status === "imported" && typeof file.statementBalance === "number" ? <small>Ekstre borcu: {money(file.statementBalance)}</small> : file.status !== "imported" && file.statementBalance == null ? <small>{file.status === "review" ? "Belgeden okunamadı" : "Analiz sonrası görünür"}</small> : null}</div>
        <span className="tag">{activeId === file.id ? "Analiz açılıyor…" : labels[file.status] ?? file.status}</span>
        <button className="secondary" disabled={busy || (!["review", "imported"].includes(file.status) && !aiConfigured)} onClick={() => open(file, !["review", "imported"].includes(file.status))}>{file.status === "imported" ? "Görüntüle / düzenle" : file.status === "review" ? "Sonucu görüntüle" : file.status === "analyzing" ? "Analizi kontrol et" : file.status === "failed" ? "Tekrar analiz et" : "AI ile analiz et"}</button>
        <button className="icon-button" disabled={busy} aria-label={`${file.name} ve bağlı işlemleri sil`} title="Ekstreyi ve bağlı işlemleri sil" onClick={() => remove(file)}><Trash2 size={16}/></button>
      </div>)}
      {!statements.length && <div className="table-empty">Yüklediğin belgeler burada listelenecek.</div>}
      {activeId && <p className="review-message" role="status">Belge işleniyor. Analiz birkaç dakika sürebilir; sonuç gelene kadar bu ekranı açık tutun.</p>}
    </section>
    {review && <section className="panel analysis-review">
      <div className="panel-heading"><div><h2>Ekstre analizi · {review.analysis.bank ?? "Banka belirtilmedi"}</h2><p>{statements.find(file => file.id === review.id)?.name}</p></div><button aria-label="Analizi kapat" disabled={busy} onClick={() => setReview(null)}><X size={18}/></button></div>
      <div className="review-details">
        <p>{review.analysis.summary}</p>
        {review.imported && <p className="form-hint">Aşağıdaki tablo kaydedilmiş güncel işlemleri gösterir. Yeni satır ekleyebilir, mevcut satırları düzenleyebilir veya silebilirsin.</p>}
        <a className="text-button" href={`/api/statements/${review.id}/document`} target="_blank" rel="noopener noreferrer">Kaynak belgeyi aç</a>
        <div className="review-meta">
          <span>Ekstre tarihi: {review.analysis.statementDate ?? "Okunamadı"}</span>
          <span>Son ödeme: {review.analysis.dueDate ?? "Okunamadı"}</span>
          <span>Dönem borcu: {review.analysis.statementBalance === null ? "Okunamadı" : money(review.analysis.statementBalance)}</span>
          {installmentRows.length > 0 && (
            <span className="installment-summary-badge">
              <Layers size={13} /> Taksitli işlemler: <strong>{installmentRows.length} adet · {money(installmentTotal)}</strong> (Bu ayın taksit yükü)
            </span>
          )}
        </div>
        {review.analysis.warnings.length > 0 && <ul className="review-warnings">{review.analysis.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
        <p className="form-hint">Dönem borcu önceki bakiyeyi de içerebilir; yeni harcama toplamıyla aynı olmak zorunda değildir. Ödemeler ve döviz satırları kaydedilmez. Belirsiz satırları “Kontrol ettim, kayda dahil et” veya üstteki toplu onay düğmesiyle onaylayın.</p>
        <label className="review-card">İşlemlerin kaydedileceği kart<select aria-label="Hedef kart" value={cardId} disabled={busy} onChange={event => setCardId(event.target.value)}><option value="">Kart seçin</option>{cards.map(card => <option key={card.id} value={card.id}>{card.name} · {card.lastFour}</option>)}</select></label>
        <label className="review-card">Ekstrenin ait olduğu ay<input required type="month" aria-label="Ekstre ayı" value={reportMonth} disabled={busy} onChange={event => setReportMonth(event.target.value)}/></label>
        <p className="form-hint">Bu ekstreden kaydedilen tüm harcamalar ve iadeler seçtiğin ayda değerlendirilir. Örneğin 25 Eylül–25 Ekim ekstresi Ekim’e aittir. İşlemlerin gerçek tarihleri aşağıdaki tabloda korunur. Ay, hesap kesim tarihinden önerilir; gerekirse değiştirebilirsin.</p>
        {!cards.length && !review.imported && <p className="form-hint">Aktarmak için önce Kartlarım ekranından kart ekleyin. Analiz sonucu saklanır; bu ekrandan tekrar açabilirsiniz.</p>}
      </div>

      {/* ANLIK GEÇMİŞ KATEGORİ ÇAKIŞMA UYARISI (2. MADDE) */}
      {historyPrompt && (
        <div className="history-conflict-banner" role="alert">
          <div className="history-conflict-text">
            <AlertCircle size={16} />
            <span>
              Önceki aylarda <strong>{historyPrompt.merchant}</strong> türü harcamaları <strong>{historyPrompt.oldCategoryIds.map(id => categoryLabel(categories, id)).join(", ")}</strong> olarak işaretlemiştin ({historyPrompt.count} kayıt). Artık geçmiştekilerle birlikte hepsini <strong>{categoryLabel(categories, historyPrompt.newCategoryId)}</strong> olarak mı işaretlemek istersin, yoksa eskiler kalsın mı?
            </span>
          </div>
          <div className="history-conflict-actions">
            <button type="button" className="primary" onClick={() => confirmHistoryReplace(true)}>
              Tüm geçmişi de {categoryLabel(categories, historyPrompt.newCategoryId)} yap
            </button>
            <button type="button" className="secondary" onClick={() => confirmHistoryReplace(false)}>
              Eskiler kalsın, sadece bu ekstreyi güncelle
            </button>
          </div>
        </div>
      )}

      <div className="review-toolbar">
        <div className="review-search"><Search size={16}/><input aria-label="Ekstre işlemlerinde ara" placeholder="İş yeri ara…" value={query} onChange={event => setQuery(event.target.value)}/></div>
        <button type="button" className="secondary" aria-pressed={onlyReview} onClick={() => setOnlyReview(value => !value)}>Kontrol gerekenler {rows.filter(row => row.needsReview).length}</button>
        {unapprovedVisibleCount > 0 && (
          <button type="button" className="secondary approve-all-btn" disabled={busy} onClick={approveAllNeedsReview}>
            <CheckCheck size={15} /> Görünenlerin tümünü onayla ve dahil et ({unapprovedVisibleCount})
          </button>
        )}
        <button type="button" className="secondary" disabled={busy} onClick={addManualRow}>
          <Plus size={15} /> Satır ekle
        </button>
        <label className="review-sort">Sıralama<select aria-label="Ekstre işlemlerini sırala" value={sort} onChange={event => setSort(event.target.value as StatementSort)}><option value="merchant-asc">İş yeri · A → Z</option><option value="merchant-desc">İş yeri · Z → A</option><option value="date-asc">Tarih · eskiden yeniye</option><option value="date-desc">Tarih · yeniden eskiye</option></select></label>
        <span>{visibleRows.length} / {rows.length} işlem</span>
      </div>

      <div className="review-batch-toolbar"><button type="button" className="secondary" disabled={busy || !editableIndices.length} onClick={() => setBatch(editableIndices.every(index => batch.includes(index)) ? [] : editableIndices)}><CheckCheck size={15}/>{editableIndices.length > 0 && editableIndices.every(index => batch.includes(index)) ? "Seçimi kaldır" : "Görünenleri kategori için seç"}</button><span>{batch.length ? `${batch.length} satır kategori için seçili` : "Kutular yalnızca toplu kategori atamak içindir; kayda dahil olmayı etkilemez."}</span>{batch.length > 0 && <><CategoryPicker categories={categories} value={batchCategory} label="Seçili satırlara kategori ata" disabled={busy} onChange={id => { setBatchCategory(id); assignCategory(batch, id); setBatch([]); }}/><button className="text-button" onClick={() => setBatch([])}>Vazgeç</button></>}</div>
      <p className="review-auto-category-note"><Sparkles size={14}/> Kategori seçtiğinde bu ekstredeki aynı ve benzer iş yerlerinin kategorileri de otomatik güncellenir.</p>
      <div className="table-wrap"><table className="review-table"><thead><tr><th title="Yalnızca birlikte kategori atamak istediğin satırları seç">KATEGORİ İÇİN SEÇ</th><th>KAYIT DURUMU</th><th>TARİH</th><th>İŞ YERİ</th><th>TUTAR</th><th>KATEGORİ</th><th>TÜR</th><th>KAYNAK / TAKSİT</th></tr></thead><tbody>{visibleRows.map(({ row, index }) => <tr key={row.id ?? `row-${index}`} className={`${row.needsReview ? "needs-review" : ""} ${batch.includes(index) ? "batch-selected" : ""} ${row.deleted ? "marked-deleted" : ""}`}>
        <td><input type="checkbox" aria-label={`${index + 1}. satırı toplu kategori için seç`} disabled={busy || row.deleted || row.kind === "payment" || row.currency !== "TRY"} checked={batch.includes(index)} onChange={event => setBatch(current => event.target.checked ? [...current, index] : current.filter(value => value !== index))}/></td>
        <td><div className="review-row-status"><span className={row.deleted ? "status-deleted" : isStatementRowIncluded(row) ? "status-included" : "status-excluded"}>{row.deleted ? "Silinecek" : review.imported && row.id ? "Kayıtlı" : isStatementRowIncluded(row) ? "Kaydedilecek" : row.currency !== "TRY" || row.kind === "payment" ? "Kaydedilmez" : "Onayın bekleniyor"}</span>{row.currency === "TRY" && row.kind !== "payment" && <button type="button" className={row.deleted ? "restore-row" : "delete-row"} disabled={busy} onClick={() => markDeleted(index, !row.deleted)}>{row.deleted ? <RotateCcw size={13}/> : <Trash2 size={13}/>} {row.deleted ? "Geri al" : "Sil"}</button>}{!row.deleted && (!row.selected || row.needsReview) && row.currency === "TRY" && row.kind !== "payment" && <button type="button" className="include-row" disabled={busy} onClick={() => change(index, { selected: true, needsReview: false })}>Kontrol ettim, kayda dahil et</button>}</div></td>
        <td><input type="date" aria-label={`${index + 1}. işlem tarihi`} value={row.date} disabled={busy || row.deleted} onChange={event => change(index, { date: event.target.value })}/></td>
        <td><input aria-label={`${index + 1}. iş yeri`} title={row.merchant} value={row.merchant} maxLength={500} disabled={busy || row.deleted} onChange={event => change(index, { merchant: event.target.value, learning: undefined })}/></td>
        <td><input aria-label={`${index + 1}. tutar`} inputMode="decimal" value={row.amountText} disabled={busy || row.deleted} onChange={event => change(index, { amountText: event.target.value })}/><small>{row.currency}</small>{row.sourceAmount && <small>Okunan: {row.sourceAmount}</small>}</td>
        <td><CategoryPicker label={`${index + 1}. kategori ve alt kategori`} categories={categories} value={row.category} disabled={busy || row.deleted || row.kind === "payment" || row.currency !== "TRY"} onChange={id => assignCategory([index], id)}/>
          {row.learning?.source === "learned" && <small className="learned-category">Önceki {row.learning.examples} seçiminden öğrenildi{row.learning.matchType === "similar" ? " (benzer şube)" : ""}</small>}
          {row.learning?.source === "conflict" && <small className="conflicting-category">Önceki seçimlerin farklı ({row.learning.learnedCategories?.map(id => categoryLabel(categories, id)).join(" / ")}). Kategoriyi seçerek netleştir.</small>}
          <label className="remember-category"><input type="checkbox" aria-label={`${index + 1}. iş yeri kategorisini hatırla`} checked={Boolean(row.rememberCategory)} disabled={busy || row.deleted || row.kind === "payment" || row.currency !== "TRY"} onChange={event => change(index, { rememberCategory: event.target.checked })}/>Sonraki ekstreler için hatırla</label>
        </td>
        <td><select aria-label={`${index + 1}. işlem türü`} value={row.kind} disabled={busy || row.deleted} onChange={event => change(index, { kind: event.target.value as AnalysisRow["kind"], selected: review.imported || (event.target.value !== "payment" && row.currency === "TRY" && !row.needsReview) })}>{Object.entries(kinds).filter(([kind]) => !review.imported || kind !== "payment").map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></td>
        <td>
          <span>Sayfa {row.page}</span>
          <input
            aria-label={`${index + 1}. taksit bilgisi`}
            className="installment-input"
            placeholder="Tek işlem (Örn. 2/6)"
            value={row.installment ?? ""}
            disabled={busy || row.deleted}
            maxLength={40}
            onChange={event => change(index, { installment: event.target.value || null })}
          />
        </td>
      </tr>)}</tbody></table></div>
      {rows.length > 0 && !visibleRows.length && <div className="table-empty">Arama ve filtreyle eşleşen işlem yok.</div>}
      {!rows.length && <div className="table-empty">{review.imported ? "Bu ekstreye ait kayıtlı işlem bulunmuyor." : "Aktarılabilecek hareket bulunamadı. Yukarıdaki analiz notlarını kontrol edin."}</div>}
      <div className="review-footer">{editNotice && <div className="review-edit-notice" role="status"><span>{editNotice}</span>{categoryUndo.length > 0 && <button type="button" disabled={busy} onClick={undoCategory}>Son kategori atamasını geri al</button>}</div>}<span>{selectedCount} {review.imported ? "kayıtlı" : "kaydedilecek"} işlem{deletedCount > 0 ? ` · ${deletedCount} silinecek${review.imported ? "" : " (kaydedilmeyecek)"}` : ""}{installmentRows.length > 0 ? ` · ${installmentRows.length} taksitli (${money(installmentTotal)})` : ""} · Ekstre ayı {reportMonth || "seçilmedi"} · Net {money(net)}</span><button className="primary" disabled={busy || !cardId || !reportMonth || (!selectedCount && !(review.imported && deletedCount > 0))} onClick={save}>{review.imported ? "Değişiklikleri kaydet" : "İşlemleri kaydet"}</button></div>
    </section>}
  </>;
}
