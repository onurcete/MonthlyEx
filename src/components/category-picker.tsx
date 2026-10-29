"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Clock3, Search, X } from "lucide-react";
import type { Category } from "@/lib/types";
import { categoryLabel } from "@/lib/categories";

type Props = { categories: Category[]; value: string; onChange: (id: string) => void; disabled?: boolean; label?: string; name?: string; placeholder?: string };
const normalize = (text: string) => text.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

export default function CategoryPicker({ categories, value, onChange, disabled, label = "Kategori seç", name, placeholder = "Kategori seç" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 420, maxHeight: 460 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = categories.find(item => item.id === value);
  const parent = categories.find(item => item.id === selected?.parentId);
  const roots = categories.filter(item => item.parentId === null);
  const currentRoot = roots.find(item => item.id === root);
  const results = categories.filter(item => (root ? item.id === root || item.parentId === root : item.parentId === null) && normalize(item.name).includes(normalize(query.trim())))
    .sort((a, b) => {
      const priority = (item: Category) => item.id === value ? -100 : recent.includes(item.id) ? -50 + recent.indexOf(item.id) : 0;
      return query || root ? 0 : priority(a) - priority(b);
    });
  const activeIndex = Math.min(cursor, Math.max(0, results.length - 1));
  function close() { setOpen(false); trigger.current?.focus(); }
  function select(id: string) {
    onChange(id);
    const next = [id, ...recent.filter(item => item !== id)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem("monthlyex:recent-categories", JSON.stringify(next)); } catch { /* Optional preference. */ }
    close();
  }
  function choose(id: string) {
    if (!root && categories.some(item => item.parentId === id)) {
      setRoot(id); setQuery(""); setCursor(0); search.current?.focus();
    } else select(id);
  }
  function back() { setRoot(""); setQuery(""); setCursor(0); search.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("monthlyex:recent-categories") ?? "[]");
      if (Array.isArray(saved)) setRecent(saved.filter((id): id is string => typeof id === "string").slice(0, 5));
    } catch { /* Optional preference. */ }
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(440, window.innerWidth - 24);
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      const height = Math.min(460, Math.max(below, above));
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= Math.min(380, above) ? rect.bottom + 6 : Math.max(12, rect.top - height - 6), width, maxHeight: height });
    }
    place(); search.current?.focus();
    function outside(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" }); }, [open, root, query, activeIndex, listId]);

  return <>
    {name && <input type="hidden" name={name} value={value}/>}
    <button ref={trigger} type="button" className="category-picker-trigger" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open} title={categoryLabel(categories, value)} onClick={() => { setQuery(""); setRoot(""); setCursor(0); setOpen(current => !current); }}>
      <span><strong>{parent?.name ?? selected?.name ?? placeholder}</strong>{parent && <small>{selected?.name}</small>}</span><ChevronDown size={14}/>
    </button>
    {open && createPortal(<div ref={panel} className="quick-category" role="dialog" aria-label={label} style={position}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.target === search.current && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setCursor((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length)); }
        if (event.target === search.current && event.key === "Enter") { event.preventDefault(); if (results[activeIndex]) choose(results[activeIndex].id); }
        if (event.target === search.current && event.key === "ArrowLeft" && !query && root) { event.preventDefault(); back(); }
      }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== trigger.current) setOpen(false); }}>
      <div className="quick-category-stage"><div>{root && <button type="button" aria-label="Ana kategori listesine dön" onClick={back}><ArrowLeft size={16}/></button>}<span><small>{root ? "2 / 2 · ALT KATEGORİ" : "1 / 2 · ANA KATEGORİ"}</small><strong>{currentRoot?.name ?? "Ana kategoriyi seç"}</strong></span></div><button type="button" aria-label="Kategori seçimini kapat" onClick={close}><X size={17}/></button></div>
      <div className="quick-category-search"><Search size={17}/><input ref={search} role="combobox" aria-label={root ? "Alt kategori ara" : "Ana kategori ara"} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined} placeholder={root ? "Alt kategori ara…" : "Ana kategori ara…"} value={query} onChange={event => { setQuery(event.target.value); setCursor(0); }}/></div>
      <div className="quick-category-results" role="listbox" id={listId} aria-label={root ? "Alt kategoriler" : "Ana kategoriler"}>
        {results.map((item, index) => <button type="button" role="option" aria-selected={item.id === value || (!root && item.id === parent?.id)} id={`${listId}-${index}`} key={item.id} tabIndex={-1} className={index === activeIndex ? "highlighted" : ""} onPointerMove={() => setCursor(index)} onClick={() => choose(item.id)}>
          <span><strong>{root && item.id === root ? "Genel · alt kategori belirtmeden" : item.name}</strong><small>{root ? currentRoot?.name : `${categories.filter(child => child.parentId === item.id).length} alt kategori`}</small></span>{!root && categories.some(child => child.parentId === item.id) ? <ChevronRight size={16}/> : item.id === value ? <Check size={16}/> : recent.includes(item.id) ? <Clock3 size={14}/> : null}
        </button>)}
        {!results.length && <p className="quick-category-empty">Kategori bulunamadı. Başka bir kelime dene.</p>}
      </div>
      <div className="quick-category-hint"><span>{results.length} sonuç</span><span>↑ ↓ gezin · Enter seç · Esc kapat</span></div>
    </div>, document.body)}
  </>;
}
