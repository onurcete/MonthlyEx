"use client";
import { useState } from "react";
import type { Category } from "@/lib/types";

export default function CategoryEditor({ categories, value, busy, onSave, label = "Kategori güncelle", draftValue, onChange }: { categories: Category[]; value: string; busy: boolean; onSave: (id: string) => Promise<void>; label?: string; draftValue?: string; onChange?: (id: string) => void }) {
  const [localDraft, setLocalDraft] = useState(value);
  const draft = draftValue ?? localDraft;
  function setDraft(id: string) { if (onChange) onChange(id); else setLocalDraft(id); }
  const selected = categories.find(item => item.id === draft);
  const root = selected?.parentId ?? selected?.id ?? "";
  const children = categories.filter(item => item.parentId === root);
  return <div className="transaction-category-editor"><label>Ana kategori<select aria-label={`${label} ana kategori`} value={root} disabled={busy} onChange={event => setDraft(event.target.value)}><option value="">Ana kategori seç</option>{categories.filter(item => item.parentId === null).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Alt kategori<select aria-label={`${label} alt kategori`} value={selected?.parentId ? selected.id : ""} disabled={busy || !root || !children.length} onChange={event => setDraft(event.target.value || root)}><option value="">Genel / alt kategori yok</option>{children.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="secondary" disabled={busy || !root || draft === value} onClick={() => onSave(draft)}>{busy ? "Kaydediliyor…" : "Güncelle"}</button></div>;
}
