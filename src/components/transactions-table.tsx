"use client";
import { useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Save, Trash2 } from "lucide-react";
import type { AppData, Expense } from "@/lib/types";
import { categoryLabel } from "@/lib/categories";
import { similarStatementMerchant } from "@/lib/statement-category";
import { categoryDraftEdits, changeCategoryDraft, clearSavedCategoryDrafts, type CategoryDrafts, type CategoryEdit } from "@/lib/transaction-edits";
import CategoryEditor from "./category-editor";

const money = (value: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value / 100);
type Props = { data: AppData; rows: Expense[]; busy: boolean; onCategory: (rows: Expense[], id: string, replaceHistory?: boolean) => Promise<boolean>; onSaveChanges: (edits: CategoryEdit[], replaceHistory?: boolean) => Promise<boolean>; onRemove: (id: string) => Promise<boolean> };
type Sort = { column: "merchant" | "date"; direction: "asc" | "desc" };

export default function TransactionsTable({ data, rows, busy, onCategory, onSaveChanges, onRemove }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<CategoryDrafts>({});
  const [sort, setSort] = useState<Sort>({ column: "date", direction: "desc" });
  const [historyPrompt, setHistoryPrompt] = useState<{ merchant: string; oldCategoryIds: string[]; newCategoryId: string; edits: CategoryEdit[]; count: number } | null>(null);

  const selectedRows = rows.filter(row => selected.includes(row.id));
  const all = rows.length > 0 && rows.every(row => selected.includes(row.id));
  const pending = categoryDraftEdits(drafts);
  const hiddenPending = pending.filter(edit => !rows.some(row => row.id === edit.id)).length;
  const invalid = pending.some(edit => !data.categories.some(category => category.id === edit.category));
  const ordered = rows.slice().sort((a, b) => {
    const result = sort.column === "merchant" ? a.merchant.localeCompare(b.merchant, "tr", { numeric: true, sensitivity: "base" }) : a.date.localeCompare(b.date);
    return (sort.direction === "asc" ? result : -result) || a.id.localeCompare(b.id);
  });
  function toggleSort(column: Sort["column"]) {
    setSort(current => ({ column, direction: current.column === column && current.direction === "asc" ? "desc" : "asc" }));
  }
  function sortIcon(column: Sort["column"]) { return sort.column !== column ? <ArrowUpDown size={13}/> : sort.direction === "asc" ? <ArrowUp size={13}/> : <ArrowDown size={13}/>; }

  async function save(edits: CategoryEdit[], replaceHistory = false) {
    if (!replaceHistory && !historyPrompt && edits.length === 1) {
      const edit = edits[0];
      const targetRow = data.expenses.find(r => r.id === edit.id);
      if (targetRow) {
        const otherMatches = data.expenses.filter(r => r.id !== edit.id && similarStatementMerchant(targetRow.merchant, r.merchant) && r.category !== edit.category);
        if (otherMatches.length > 0) {
          const oldCategoryIds = [...new Set(otherMatches.map(r => r.category))];
          setHistoryPrompt({ merchant: targetRow.merchant, oldCategoryIds, newCategoryId: edit.category, edits, count: otherMatches.length });
          return;
        }
      }
    }
    setHistoryPrompt(null);
    if (await onSaveChanges(edits, replaceHistory)) setDrafts(current => clearSavedCategoryDrafts(current, edits));
  }

  return <>
    <div className="transaction-selection"><label><input type="checkbox" checked={all} disabled={busy || !rows.length} onChange={() => setSelected(all ? [] : rows.map(row => row.id))}/> Listelenenleri kategori için seç</label><span>{selectedRows.length} seçili · {rows.length} işlem{pending.length > 0 ? ` · ${pending.length} kaydedilmemiş değişiklik` : ""}</span></div>
    {historyPrompt && (
      <div className="history-conflict-banner" role="alert">
        <div className="history-conflict-text">
          <AlertCircle size={16} />
          <span>
            <strong>{historyPrompt.merchant}</strong> için daha önceki aylarda <strong>{historyPrompt.oldCategoryIds.map(id => categoryLabel(data.categories, id)).join(", ")}</strong> seçmiştin ({historyPrompt.count} kayıt). Artık geçmiştekilerle birlikte hepsini <strong>{categoryLabel(data.categories, historyPrompt.newCategoryId)}</strong> olarak mı işaretlemek istersin, yoksa eskiler olduğu gibi kalsın mı?
          </span>
        </div>
        <div className="history-conflict-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => save(historyPrompt.edits, true)}>
            Tüm geçmişi de {categoryLabel(data.categories, historyPrompt.newCategoryId)} yap ({historyPrompt.count + 1})
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => save(historyPrompt.edits, false)}>
            Eskiler kalsın, sadece bunu güncelle
          </button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setHistoryPrompt(null)}>
            Vazgeç
          </button>
        </div>
      </div>
    )}
    <div className="table-wrap"><table className="editable-transactions"><thead><tr><th>Seç</th><th aria-sort={sort.column === "merchant" ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="transaction-sort" onClick={() => toggleSort("merchant")}>İş yeri / açıklama {sortIcon("merchant")}</button></th><th aria-sort={sort.column === "date" ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="transaction-sort" onClick={() => toggleSort("date")}>Tarih {sortIcon("date")}</button></th><th>Kategori düzenle</th><th>Kart</th><th className="amount">Tutar</th><th>Sil</th></tr></thead><tbody>{ordered.map(item => <tr key={item.id} className={drafts[item.id] ? "transaction-dirty" : ""}>
      <td><input type="checkbox" aria-label={`${item.merchant} kategorisini toplu düzenlemek için seç`} checked={selected.includes(item.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/></td>
      <td><span className="merchant-avatar">{item.merchant[0]}</span><strong>{item.merchant}</strong></td><td>{new Date(`${item.date}T12:00:00`).toLocaleDateString("tr-TR")}</td>
      <td><CategoryEditor label={item.merchant} categories={data.categories} value={item.category} draftValue={drafts[item.id]?.category ?? item.category} busy={busy} onChange={category => setDrafts(current => changeCategoryDraft(current, item.id, item.category, category))} onSave={async category => { await save([{ id: item.id, category, expectedCategory: drafts[item.id]?.expectedCategory ?? item.category }]); }}/>{drafts[item.id] && <small className="transaction-pending-label">Kaydedilmedi</small>}</td>
      <td>{data.cards.find(card => card.id === item.cardId)?.name}</td><td className={`amount ${item.kind === "refund" ? "refund" : ""}`}>{item.kind === "refund" ? "+" : "−"}{money(item.amount)}</td><td><button disabled={busy} className="icon-button" aria-label={`${item.merchant} işlemini sil`} onClick={async () => { if (await onRemove(item.id)) { setDrafts(current => { const next = { ...current }; delete next[item.id]; return next; }); setSelected(current => current.filter(id => id !== item.id)); } }}><Trash2 size={15}/></button></td>
    </tr>)}</tbody></table></div>
    {!rows.length && <div className="table-empty">Seçili dönem ve filtrelerle eşleşen işlem bulunamadı.</div>}
    <div className="transaction-bulk-category"><div><strong>Seçili işlemlerin kategorisini güncelle</strong><p>Aşağıdan ana kategori ve alt kategori seç. Değişiklik, kaydedilmiş ekstredeki aynı işlemlere ve kategori hafızasına da yansır.</p></div>{selectedRows.length ? <CategoryEditor key={selectedRows.map(item => `${item.id}:${item.category}`).join(",")} label="Seçili işlemler" categories={data.categories} value="" busy={busy} onSave={async id => { if (await onCategory(selectedRows, id, true)) { setSelected([]); setDrafts(current => { const next = { ...current }; selectedRows.forEach(row => delete next[row.id]); return next; }); } }}/> : <span>Önce listeden bir veya birkaç işlem seç.</span>}</div>
    <div className="transaction-save-all"><div role="status"><strong>{pending.length ? `${pending.length} kategori değişikliği kaydedilmeyi bekliyor` : "Kaydedilmemiş kategori değişikliği yok"}</strong><p>{hiddenPending > 0 ? `${hiddenPending} değişiklik mevcut filtrelerin dışında; onlar da birlikte kaydedilecek. ` : ""}{invalid ? "Kaydetmeden önce her değişen satır için geçerli bir kategori seç." : "Her satırı ayrı ayrı veya bütün değişiklikleri tek seferde kaydedebilirsin."}</p></div><div><button type="button" className="secondary" disabled={busy || !pending.length} onClick={() => setDrafts({})}>Değişikliklerden vazgeç</button><button type="button" className="primary" disabled={busy || !pending.length || invalid} onClick={() => save(pending)}><Save size={15}/>{busy ? "Kaydediliyor…" : `Tüm değişiklikleri kaydet${pending.length ? ` (${pending.length})` : ""}`}</button></div></div>
  </>;
}
