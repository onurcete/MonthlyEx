"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowUpRight, ChartNoAxesCombined, ChevronLeft, ChevronRight, CreditCard, FileText, LayoutDashboard, Plus, ShieldCheck, Trash2, Upload, Wallet, X } from "lucide-react";
import { categories, type AppData } from "@/lib/types";

const money = (cents: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(cents / 100);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
const colors = ["#186952", "#d6a354", "#7893b4", "#b893a6", "#8eab7b", "#ce8470", "#8e87b5", "#68a7a0", "#c4b371", "#a6aba6"];

export default function Dashboard() {
  const [data, setData] = useState<AppData>({ cards: [], expenses: [], statements: [] });
  const [month, setMonth] = useState(today().slice(0, 7));
  const [view, setView] = useState("overview");
  const [modal, setModal] = useState<"card" | "expense" | null>(null);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error("Kayıtlar yüklenemedi. Sunucunun çalıştığını kontrol edin.");
    setData(await response.json());
  }
  useEffect(() => { refresh().catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, []);
  const monthly = data.expenses.filter(item => item.date.startsWith(month));
  const spent = monthly.filter(item => item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
  const refunds = monthly.filter(item => item.kind === "refund").reduce((sum, item) => sum + item.amount, 0);
  const breakdown = useMemo(() => categories.map((name, index) => ({ name, color: colors[index], amount: monthly.filter(item => item.category === name).reduce((sum, item) => sum + (item.kind === "refund" ? -item.amount : item.amount), 0) })).filter(item => item.amount !== 0).sort((a, b) => b.amount - a.amount), [monthly]);
  const filtered = monthly.filter(item => (!category || item.category === category) && item.merchant.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")));
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  function shiftMonth(delta: number) {
    const date = new Date(`${month}-15T12:00:00`);
    date.setMonth(date.getMonth() + delta);
    setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
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
      await refresh(); setModal(null); setMessage("Kayıt eklendi.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kayıt eklenemedi."); }
    finally { setBusy(false); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/statements", { method: "POST", body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await refresh(); form.reset(); setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Dosya yüklenemedi."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("Bu işlem silinsin mi?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error("İşlem silinemedi.");
      await refresh(); setMessage("İşlem silindi.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "İşlem silinemedi."); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-icon"><ChartNoAxesCombined size={23}/></span>monthly<span>ex</span><i>•</i></a>
      <div className="workspace-label">KİŞİSEL ALANIN</div>
      <nav>{[{ id: "overview", label: "Genel bakış", icon: LayoutDashboard }, { id: "transactions", label: "İşlemler", icon: ArrowDownLeft }, { id: "cards", label: "Kartlarım", icon: CreditCard }, { id: "statements", label: "Ekstreler", icon: FileText }].map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id)}><Icon size={18}/>{label}{id === "statements" && data.statements.length > 0 && <small>{data.statements.length}</small>}</button>)}</nav>
      <div className="sidebar-note"><ShieldCheck size={21}/><strong>Verilerin seninle.</strong><p>Bu sürümde kayıtların ve belgelerin bilgisayarında saklanır.</p><span><b/> Yerel çalışma alanı</span></div>
      <div className="profile"><div className="avatar">O</div><div><strong>Kişisel hesap</strong><small>MonthlyEx / Yerel</small></div></div>
    </aside>
    <main>
      <header className="topbar"><span>Çalışma alanı <span className="slash">/</span> <strong>{view === "overview" ? "Genel bakış" : view === "transactions" ? "İşlemler" : view === "cards" ? "Kartlarım" : "Ekstreler"}</strong></span><span className="local-badge"><b/> Yerel sürüm</span></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">HARCAMALARINA YENİ BİR BAKIŞ</div><h1>{view === "overview" ? "Paran nereye gidiyor?" : view === "transactions" ? "Her işlem, bir yerde." : view === "cards" ? "Kartların bir arada." : "Ekstrelerini bir araya getir."}</h1><p>{view === "statements" ? "Belgelerini yükle, aylık harcama arşivini oluştur." : "Kartlarını bir araya getir. Harcamalarını anlamlandır."}</p></div><button className="primary" onClick={() => setView("statements")}><Upload size={16}/> Ekstre yükle</button></div>
        {message && <div className="notice" role="status">{message}<button aria-label="Bildirimi kapat" onClick={() => setMessage("")}><X size={16}/></button></div>}
        {loading && <p role="status">Kayıtlar yükleniyor…</p>}
        {(view === "overview" || view === "transactions") && <>
          <div className="period-row"><div className="month-picker"><button aria-label="Önceki ay" onClick={() => shiftMonth(-1)}><ChevronLeft size={16}/></button><label><span>{monthLabel}</span><input aria-label="Ay seç" type="month" value={month} onChange={event => event.target.value && setMonth(event.target.value)}/></label><button aria-label="Sonraki ay" onClick={() => shiftMonth(1)}><ChevronRight size={16}/></button></div><span>Tüm kartlar · TRY</span></div>
          {view === "overview" && <>
            <div className="stats"><section className="stat featured"><div>Net harcama <Wallet size={19}/></div><strong>{money(spent - refunds)}</strong><small>Harcamalar − iadeler</small><div className="stat-decoration"/></section><section className="stat"><div>Toplam harcama <ArrowUpRight size={19}/></div><strong>{money(spent)}</strong><small>{monthly.filter(item => item.kind === "expense").length} harcama işlemi</small></section><section className="stat"><div>İadeler <ArrowDownLeft size={19}/></div><strong>{money(refunds)}</strong><small>Seçili ayda hesabına dönen</small></section><section className="stat"><div>Kartların <CreditCard size={19}/></div><strong>{data.cards.length}<em> kart</em></strong><small>Tek ekranda, birlikte</small></section></div>
            <div className="analysis-grid"><section className="panel"><div className="panel-heading"><div><h2>Kategori dağılımı</h2><p>Bu ayın harcama haritası</p></div><span className="tag">Net tutarlar</span></div>{breakdown.length ? <div className="category-list">{breakdown.map(item => <div key={item.name} className="category-row"><div><span className="dot" style={{ background: item.color }}/><span>{item.name}</span><strong>{money(item.amount)}</strong></div><div className="bar-track"><div style={{ width: `${Math.min(100, Math.abs(item.amount) / Math.max(...breakdown.map(row => Math.abs(row.amount))) * 100)}%`, background: item.color }}/></div></div>)}</div> : <div className="empty"><div className="empty-icon"><ChartNoAxesCombined size={28}/></div><h3>Harcama haritan burada oluşacak.</h3><p>İlk işlemini eklediğinde kategorilerin<br/>ve dağılımların bu alanda görünecek.</p><button className="text-button" onClick={() => setModal(data.cards.length ? "expense" : "card")}>İlk {data.cards.length ? "işlemini" : "kartını"} ekle <ArrowUpRight size={15}/></button></div>}</section><section className="insight"><span className="eyebrow">KÜÇÜK ADIMLAR, NET BİR TABLO</span><h2>Ayın tamamını<br/>bir arada gör.</h2><p>Farklı kartlar, farklı harcamalar.<br/>Hepsi tek bir aylık görünümde.</p><div className="onboarding-step"><span>01</span><div><strong>Kartını ekle</strong><p>Bir isim ve son dört hane yeterli.</p></div>{data.cards.length > 0 && <ShieldCheck size={18}/>}</div><div className="onboarding-step"><span>02</span><div><strong>İşlemlerini kaydet</strong><p>Kategori seç, harcamanı takip et.</p></div></div><div className="onboarding-step"><span>03</span><div><strong>Aylık tabloyu keşfet</strong><p>En çok harcadığın alanları gör.</p></div></div><button onClick={() => setModal(data.cards.length ? "expense" : "card")}>Bir kayıt ekle <Plus size={16}/></button></section></div>
          </>}
          <section className="panel transactions"><div className="panel-heading"><div><h2>{view === "overview" ? "Son işlemler" : "İşlemler"}</h2><p>Seçili ayın harcamaları ve iadeleri</p></div><button className="secondary" onClick={() => setModal(data.cards.length ? "expense" : "card")}><Plus size={15}/> İşlem ekle</button></div><div className="filters"><input placeholder="İş yeri ara…" aria-label="İş yeri ara" value={query} onChange={event => setQuery(event.target.value)}/><select aria-label="Kategoriye göre filtrele" value={category} onChange={event => setCategory(event.target.value)}><option value="">Tüm kategoriler</option>{categories.map(name => <option key={name}>{name}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>İŞ YERİ / AÇIKLAMA</th><th>TARİH</th><th>KATEGORİ</th><th>KART</th><th className="amount">TUTAR</th><th><span className="sr-only">İşlemler</span></th></tr></thead><tbody>{filtered.slice(0, view === "overview" ? 8 : undefined).map(item => <tr key={item.id}><td><span className="merchant-avatar">{item.merchant.charAt(0).toLocaleUpperCase("tr")}</span><strong>{item.merchant}</strong></td><td>{new Date(`${item.date}T12:00:00`).toLocaleDateString("tr-TR")}</td><td><span className="category-chip">{item.category}</span></td><td>{data.cards.find(card => card.id === item.cardId)?.name}</td><td className={`amount ${item.kind === "refund" ? "refund" : ""}`}>{item.kind === "refund" ? "+" : "−"}{money(item.amount)}</td><td><button disabled={busy} className="icon-button" aria-label={`${item.merchant} işlemini sil`} onClick={() => remove(item.id)}><Trash2 size={15}/></button></td></tr>)}</tbody></table>{!filtered.length && <div className="table-empty">{monthly.length ? "Filtrelere uygun işlem bulunamadı." : "Bu ay için henüz işlem yok. Yeni bir işlem ekleyerek başlayabilirsin."}</div>}</div></section>
        </>}
        {view === "cards" && <><div className="section-actions"><h2>Kayıtlı kartlar <span className="tag">{data.cards.length}</span></h2><button className="primary" onClick={() => setModal("card")}><Plus size={16}/> Kart ekle</button></div><div className="cards-grid">{data.cards.map(card => <section className="bank-card" key={card.id}><div><strong>{card.name}</strong><CreditCard size={26}/></div><p>•••• &nbsp; •••• &nbsp; •••• &nbsp; {card.lastFour}</p><small>KİŞİSEL KART</small></section>)}</div>{!data.cards.length && <section className="panel empty"><CreditCard size={34}/><h3>İlk kartınla başla.</h3><p>Tam kart numarasına ihtiyaç yok.<br/>Kart adı ve son dört hane yeterli.</p><button className="primary" onClick={() => setModal("card")}><Plus size={16}/> Kart ekle</button></section>}</>}
        {view === "statements" && <><section className="panel upload-panel"><div className="empty-icon"><Upload size={28}/></div><h2>Ekstrene yer aç.</h2><p>PDF veya ekstre fotoğrafını seç. Dosyan yalnızca bu bilgisayarda saklanır.</p><form onSubmit={upload}><input required name="file" aria-label="Ekstre dosyası" type="file" accept="application/pdf,image/png,image/jpeg,image/webp"/><button className="primary" disabled={busy}>{busy ? "Yükleniyor…" : "Dosyayı kaydet"}</button></form><small>PDF, PNG, JPEG veya WebP · En fazla 20 MB</small><div className="analysis-note">İlk sürüm: dosya arşivi hazır. Otomatik işlem çıkarma ve AI kategorilendirme henüz bağlı değil; yüklenen belgeler analiz bekler.</div></section><section className="panel"><div className="panel-heading"><h2>Yüklenen ekstreler</h2><span className="tag">{data.statements.length} belge</span></div>{data.statements.length ? data.statements.map(file => <div className="statement-row" key={file.id}><FileText size={21}/><div><strong>{file.name}</strong><small>{new Date(file.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}</small></div><span className="tag">Analiz bekliyor</span></div>) : <div className="table-empty">Yüklediğin belgeler burada listelenecek.</div>}</section></>}
        <footer>MonthlyEx <span>Harcamalarını anla, ayına yön ver.</span><span>Yerel başlangıç sürümü · 0.1</span></footer>
      </div>
    </main>
    {modal && <div className="modal-backdrop" onClick={() => !busy && setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !busy) setModal(null); }}><div className="panel-heading"><h2 id="modal-title">{modal === "card" ? "Yeni kart ekle" : "İşlem ekle"}</h2><button disabled={busy} aria-label="Pencereyi kapat" onClick={() => setModal(null)}><X size={20}/></button></div><form onSubmit={save}>{modal === "card" ? <><label>Kart adı<input autoFocus required name="name" maxLength={60} placeholder="Örn. Garanti Bonus"/></label><label>Son dört hane<input required name="lastFour" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="1234"/></label><p className="form-hint">Tam kart numarası, son kullanma tarihi ve CVV girme.</p></> : <><label>Kart<select name="cardId" required>{data.cards.map(card => <option key={card.id} value={card.id}>{card.name} · {card.lastFour}</option>)}</select></label><label>İş yeri / açıklama<input autoFocus required name="merchant" maxLength={160} placeholder="Örn. Migros"/></label><div className="form-row"><label>Tarih<input required type="date" name="date" defaultValue={today()}/></label><label>Tutar (TL)<input required name="amount" inputMode="decimal" placeholder="1250,50"/></label></div><label>Kategori<select name="category">{categories.map(name => <option key={name}>{name}</option>)}</select></label><label>İşlem türü<select name="kind"><option value="expense">Harcama</option><option value="refund">İade</option></select></label></>}{message && <p role="status" className="form-hint">{message}</p>}<button className="primary" disabled={busy} type="submit">{busy ? "Kaydediliyor…" : "Kaydet"}</button></form></section></div>}
  </div>;
}
