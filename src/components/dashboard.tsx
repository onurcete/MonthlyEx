"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownLeft, ChartNoAxesCombined, ChevronLeft, ChevronRight, CreditCard, FileText, FolderTree, LayoutDashboard, Plus, ShieldCheck, Upload, X } from "lucide-react";
import type { AppData, Expense } from "@/lib/types";
import { categoryOptions } from "@/lib/categories";
import { expenseMonth } from "@/lib/reporting-period";
import Overview, { type AtlasFilters } from "./overview";
import CategoryManager from "./category-manager";
import CategoryPicker from "./category-picker";
import Statements from "./statements";
import TransactionFilters from "./transaction-filters";
import TransactionsTable from "./transactions-table";
import type { CategoryEdit } from "@/lib/transaction-edits";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());

export default function Dashboard() {
  const [data, setData] = useState<AppData>({ cards: [], expenses: [], statements: [], categories: [] });
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState("overview");
  const [modal, setModal] = useState<"card" | "expense" | null>(null);
  const [category, setCategory] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [query, setQuery] = useState("");
  const [transactionCard, setTransactionCard] = useState("");
  const [transactionDate, setTransactionDate] = useState("");
  const [allTransactionMonths, setAllTransactionMonths] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const initialized = useRef(false);
  const options = categoryOptions(data.categories);
  const months = [...new Set(data.expenses.map(expenseMonth).filter((key): key is string => key !== null))].sort().reverse();
  const unassigned = data.expenses.filter(row => row.statementId && !row.reportingMonth).length;
  async function refresh(preferredMonth?: string) {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error("Kayıtlar yüklenemedi. Sunucunun çalıştığını kontrol edin.");
    const next: AppData = await response.json();
    setData(next);
    if (preferredMonth) setMonth(preferredMonth);
    else if (!initialized.current && next.expenses.length && !next.expenses.some(row => expenseMonth(row) === today().slice(0, 7))) {
      const latest = next.expenses.map(expenseMonth).filter((key): key is string => key !== null).sort().at(-1);
      if (latest) setMonth(latest);
    }
    initialized.current = true;
  }
  useEffect(() => {
    refresh().catch(error => setMessage(error.message)).finally(() => setLoading(false));
    const onFocus = () => { refresh().catch(error => setMessage(error.message)); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  const showingAllMonths = view === "transactions" && allTransactionMonths;
  const monthly = showingAllMonths ? data.expenses : data.expenses.filter(item => expenseMonth(item) === month);
  const filtered = monthly.filter(item => (!transactionCard || item.cardId === transactionCard) && (!transactionDate || item.date === transactionDate) && (!category || item.category === category || data.categories.some(child => child.id === item.category && child.parentId === category)) && item.merchant.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  function chooseMonth(value: string) { setMonth(value); setAllTransactionMonths(false); setTransactionDate(""); }
  function openTransactions(filters: AtlasFilters) {
    setAllTransactionMonths(false); setCategory(filters.category); setQuery(filters.merchant); setTransactionCard(filters.cardId); setTransactionDate(filters.date); setView("transactions"); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function shiftMonth(delta: number) {
    const date = new Date(`${month}-15T12:00:00`);
    date.setMonth(date.getMonth() + delta);
    chooseMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = Object.fromEntries(form);
    setBusy(true); setMessage("");
    try {
      let payload: Record<string, unknown> = { ...fields, type: modal };
      if (modal === "expense") {
        const raw = String(fields.amount).trim().replace(",", ".");
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error("Tutarı 1250,50 biçiminde girin; binlik ayırıcı kullanmayın.");
        payload = { ...payload, amount: Math.round(Number(raw) * 100) };
      }
      const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refresh(modal === "expense" ? String(fields.date).slice(0, 7) : undefined); setModal(null); setMessage("Kayıt eklendi.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kayıt eklenemedi."); }
    finally { setBusy(false); }
  }
  async function remove(id: string): Promise<boolean> {
    if (!window.confirm("Bu işlem silinsin mi?")) return false;
    setBusy(true);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("İşlem silinemedi.");
      await refresh(); setMessage("İşlem silindi."); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "İşlem silinemedi."); return false; }
    finally { setBusy(false); }
  }

  async function updateCategories(rows: Expense[], categoryId: string, replaceHistory = false): Promise<boolean> {
    return saveCategoryEdits(rows.map(item => ({ id: item.id, category: categoryId, expectedCategory: item.category })), replaceHistory);
  }
  async function saveCategoryEdits(edits: CategoryEdit[], replaceHistory = false): Promise<boolean> {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/records", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edits, replaceHistory }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Kategori güncellenemedi.");
      await refresh();
      setMessage(`${result.count} işlemin kategorisi güncellendi.${result.historyUpdatedCount ? ` Geçmiş aylardaki ${result.historyUpdatedCount} benzer kayıt da yeni kategoriye taşındı.` : " Ekstredeki kayıtlar ve kategori hafızası da güncellendi."}`);
      return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kategori güncellenemedi."); return false; }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-icon"><ChartNoAxesCombined size={23}/></span>monthly<span>ex</span><i>•</i></a>
      <div className="workspace-label">KİŞİSEL ALANIN</div>
      <nav>{[{ id: "overview", label: "Genel bakış", icon: LayoutDashboard }, { id: "transactions", label: "İşlemler", icon: ArrowDownLeft }, { id: "cards", label: "Kartlarım", icon: CreditCard }, { id: "categories", label: "Kategoriler", icon: FolderTree }, { id: "statements", label: "Ekstreler", icon: FileText }].map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => { setView(id); refresh().catch(error => setMessage(error.message)); }}><Icon size={18}/>{label}{id === "statements" && data.statements.length > 0 && <small>{data.statements.length}</small>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={21}/><strong>Verilerin seninle.</strong><p>Bu sürümde kayıtların ve belgelerin bilgisayarında saklanır.</p><span><b/> Yerel çalışma alanı</span></div>
      <div className="profile"><div className="avatar">O</div><div><strong>Kişisel hesap</strong><small>MonthlyEx / Yerel</small></div></div>
    </aside>
    <main>
      <header className="topbar"><span>Çalışma alanı <span className="slash">/</span> <strong>{view === "overview" ? "Genel bakış" : view === "transactions" ? "İşlemler" : view === "cards" ? "Kartlarım" : view === "categories" ? "Kategoriler" : "Ekstreler"}</strong></span><span className="local-badge"><b/> Yerel sürüm</span></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">HARCAMALARINA YENİ BİR BAKIŞ</div><h1>{view === "categories" ? "Kategorilerini düzenle." : view === "overview" ? "Paran nereye gidiyor?" : view === "transactions" ? "Her işlem, bir yerde." : view === "cards" ? "Kartların bir arada." : "Ekstrelerini bir araya getir."}</h1><p>{view === "statements" ? "Belgelerini yükle, aylık harcama arşivini oluştur." : "Kartlarını bir araya getir. Harcamalarını anlamlandır."}</p></div><button className="primary" onClick={() => setView("statements")}><Upload size={16}/> Ekstre yükle</button></div>
        {message && <div className="notice" role="status">{message}<button aria-label="Bildirimi kapat" onClick={() => setMessage("")}><X size={16}/></button></div>}
        {loading && <p role="status">Kayıtlar yükleniyor…</p>}
        {(view === "overview" || view === "transactions") && <>
          <div className="period-row"><div className="period-controls">{view === "transactions" && <div className="segmented-control" aria-label="İşlem dönemi"><button type="button" aria-pressed={!showingAllMonths} onClick={() => { setAllTransactionMonths(false); setTransactionDate(""); }}>Seçili ay</button><button type="button" aria-pressed={showingAllMonths} onClick={() => { setAllTransactionMonths(true); setTransactionDate(""); }}>Tüm aylar</button></div>}{!showingAllMonths && <div className="month-picker"><button aria-label="Önceki ay" onClick={() => shiftMonth(-1)}><ChevronLeft size={16}/></button><label><span>{monthLabel}</span><input aria-label="Ay seç" type="month" value={month} onChange={event => event.target.value && chooseMonth(event.target.value)}/></label><button aria-label="Sonraki ay" onClick={() => shiftMonth(1)}><ChevronRight size={16}/></button></div>}{months.length > 0 && <select aria-label="Veri bulunan ayı seç" value={showingAllMonths ? "all" : months.includes(month) ? month : ""} onChange={event => { if (event.target.value === "all") { setAllTransactionMonths(true); setTransactionDate(""); } else if (event.target.value) chooseMonth(event.target.value); }}><option value="">Kayıtlı ay seç</option>{view === "transactions" && <option value="all">Tüm aylar</option>}{months.map(key => <option key={key} value={key}>{new Date(`${key}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" })}</option>)}</select>}</div><span>{showingAllMonths ? "Tüm kayıtlar" : "Ekstre ayı"} · TL</span></div>
          <p className="period-note">Toplamlar işlemin tarihine değil, ekstrenin ait olduğu aya göre hesaplanır. Manuel işlemler işlem tarihinde değerlendirilir.</p>
          {unassigned > 0 && <div className="notice" role="status">{unassigned} işlemin ekstre ayı henüz belirlenmediği için aylık analizlere dahil edilmedi.<button className="text-button" onClick={() => setView("statements")}>Ekstre ayını belirle</button></div>}
          {view === "overview" && <Overview data={data} month={month} onMonth={chooseMonth} onExplore={openTransactions}/>}
          {view === "transactions" && <section className="panel transactions"><div className="panel-heading"><div><h2>İşlemler</h2><p>{showingAllMonths ? "Tüm aylardaki harcamalar ve iadeleri" : "Seçili ayın harcamaları ve iadeleri"}</p></div><button className="secondary" onClick={() => setModal(data.cards.length ? "expense" : "card")}><Plus size={15}/> İşlem ekle</button></div><TransactionFilters cards={data.cards} categories={data.categories} query={query} setQuery={setQuery} category={category} setCategory={setCategory} card={transactionCard} setCard={setTransactionCard} date={transactionDate} setDate={setTransactionDate}/><TransactionsTable data={data} rows={filtered} busy={busy} onCategory={updateCategories} onSaveChanges={saveCategoryEdits} onRemove={remove}/></section>}
        </>}
        {view === "cards" && <><div className="section-actions"><h2>Kayıtlı kartlar <span className="tag">{data.cards.length}</span></h2><button className="primary" onClick={() => setModal("card")}><Plus size={16}/> Kart ekle</button></div><div className="cards-grid">{data.cards.map(card => <section className="bank-card" key={card.id}><div><strong>{card.name}</strong><CreditCard size={26}/></div><p>•••• &nbsp; •••• &nbsp; •••• &nbsp; {card.lastFour}</p><small>KİŞİSEL KART</small></section>)}</div>{!data.cards.length && <section className="panel empty"><CreditCard size={34}/><h3>İlk kartınla başla.</h3><p>Tam kart numarasına ihtiyaç yok.<br/>Kart adı ve son dört hane yeterli.</p><button className="primary" onClick={() => setModal("card")}><Plus size={16}/> Kart ekle</button></section>}</>}
        {view === "statements" && <Statements statements={data.statements} cards={data.cards} categories={data.categories} expenses={data.expenses} aiConfigured={Boolean(data.aiConfigured)} onRefresh={refresh} onMessage={setMessage}/>}
        {view === "categories" && <CategoryManager categories={data.categories} expenses={data.expenses} onRefresh={refresh}/>}
        <footer>MonthlyEx <span>Harcamalarını anla, ayına yön ver.</span><span>Yerel başlangıç sürümü · 0.1</span></footer>
      </div>
    </main>
    {modal && <div className="modal-backdrop" onClick={() => !busy && setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !busy) setModal(null); }}><div className="panel-heading"><h2 id="modal-title">{modal === "card" ? "Yeni kart ekle" : "İşlem ekle"}</h2><button disabled={busy} aria-label="Pencereyi kapat" onClick={() => setModal(null)}><X size={20}/></button></div><form onSubmit={save}>{modal === "card" ? <><label>Kart adı<input autoFocus required name="name" maxLength={60} placeholder="Örn. Garanti Bonus"/></label><label>Son dört hane<input required name="lastFour" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="1234"/></label><p className="form-hint">Tam kart numarası, son kullanma tarihi ve CVV girme.</p></> : <><label>Kart<select name="cardId" required>{data.cards.map(card => <option key={card.id} value={card.id}>{card.name} · {card.lastFour}</option>)}</select></label><label>İş yeri / açıklama<input autoFocus required name="merchant" maxLength={500} placeholder="Örn. Migros"/></label><div className="form-row"><label>Tarih<input required type="date" name="date" defaultValue={today()}/></label><label>Tutar (TL)<input required name="amount" inputMode="decimal" placeholder="1250,50"/></label></div><label>Kategori<CategoryPicker name="category" categories={data.categories} value={manualCategory || data.categories.find(item => item.id === "default-9")?.id || options[0]?.id || ""} onChange={setManualCategory}/></label><p className="form-hint">Kaydettiğin kategori bu iş yeri için hatırlanır ve sonraki ekstrelerde kullanılır.</p><label>İşlem türü<select name="kind"><option value="expense">Harcama</option><option value="refund">İade</option></select></label></>}{message && <p role="status" className="form-hint">{message}</p>}<button className="primary" disabled={busy} type="submit">{busy ? "Kaydediliyor…" : "Kaydet"}</button></form></section></div>}
  </div>;
}
