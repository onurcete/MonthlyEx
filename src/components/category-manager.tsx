"use client";
import { useState, type FormEvent } from "react";
import { Pencil, Plus, X } from "lucide-react";
import type { Category, Expense } from "@/lib/types";

export default function CategoryManager({ categories, expenses, onRefresh }: { categories: Category[]; expenses: Expense[]; onRefresh: () => Promise<void> }) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function reset() { setEditing(null); setName(""); setParentId(""); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/categories", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing?.id, name, parentId: parentId || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await onRefresh(); reset(); setMessage("Kategori kaydedildi. İşlem ve ekstre listeleri güncellendi.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Kategori kaydedilemedi."); }
    finally { setBusy(false); }
  }
  function edit(item: Category) { setEditing(item); setName(item.name); setParentId(item.parentId ?? ""); }
  return <div className="category-manager">
    <section className="panel category-form"><div className="panel-heading"><h2>{editing ? "Kategoriyi düzenle" : "Kategori ekle"}</h2>{editing && <button aria-label="Düzenlemeyi iptal et" onClick={reset}><X size={18}/></button>}</div>
      <form onSubmit={save}><label>Kategori adı<input required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="Örn. Gıda veya Süpermarket"/></label>
        <label>Bağlı olduğu ana kategori<select value={parentId} disabled={busy || Boolean(editing && categories.some(item => item.parentId === editing.id))} onChange={event => setParentId(event.target.value)}><option value="">Ana kategori olarak oluştur</option>{categories.filter(item => item.parentId === null && item.id !== editing?.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <p className="form-hint">Ana ve alt kategoriler tüm işlem formlarında kullanılır. Yeni AI analizleri tanımladığın kategoriler arasından seçim yapar. İsim değişiklikleri geçmiş işlemlere de yansır.</p>
        <button className="primary" disabled={busy}><Plus size={16}/>{editing ? "Değişiklikleri kaydet" : "Kategori ekle"}</button>
        {message && <p role="status" className="form-hint">{message}</p>}
      </form>
    </section>
    <section className="panel"><div className="panel-heading"><h2>Kategori ağacı</h2><span className="tag">{categories.length} kategori</span></div>
      {categories.filter(item => item.parentId === null).map(parent => <div className="category-branch" key={parent.id}>
        <div className="category-node"><strong>{parent.name}</strong><small>{expenses.filter(row => row.category === parent.id || categories.some(child => child.parentId === parent.id && child.id === row.category)).length} işlem</small><button className="icon-button" aria-label={`${parent.name} kategorisini düzenle`} onClick={() => edit(parent)}><Pencil size={15}/></button><button className="text-button" onClick={() => { reset(); setParentId(parent.id); }}>Alt kategori ekle</button></div>
        {categories.filter(item => item.parentId === parent.id).map(child => <div className="category-node child" key={child.id}><span>{child.name}</span><small>{expenses.filter(row => row.category === child.id).length} işlem</small><button className="icon-button" aria-label={`${child.name} kategorisini düzenle`} onClick={() => edit(child)}><Pencil size={15}/></button></div>)}
      </div>)}
    </section>
  </div>;
}
