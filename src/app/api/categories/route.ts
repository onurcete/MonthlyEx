import { NextResponse } from "next/server";
import { z } from "zod";
import { database, loadCategories } from "@/lib/db";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
const schema = z.object({ id: z.string().min(1).max(100).optional(), name: z.string().trim().min(1).max(80), parentId: z.string().min(1).max(100).nullable() });
async function save(request: Request, editing: boolean) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (editing && !parsed.data.id)) return NextResponse.json({ error: "Kategori adını ve ana kategoriyi kontrol edin." }, { status: 400 });
  const { name, parentId } = parsed.data;
  const id = editing ? parsed.data.id! : crypto.randomUUID();
  const db = await database();
  const tx = await db.transaction("write").catch(() => null);
  if (!tx) return NextResponse.json({ error: "Başka bir kayıt sürüyor. Tekrar deneyin." }, { status: 409 });
  try {
    const list = await tx.execute("SELECT id, name, parent_id AS parentId FROM categories");
    const items = list.rows;
    if (editing && !items.some(item => item.id === id)) { await tx.rollback(); return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 404 }); }
    if (parentId && (parentId === id || !items.some(item => item.id === parentId && item.parentId === null) || items.some(item => item.parentId === id))) {
      await tx.rollback(); return NextResponse.json({ error: "Alt kategori yalnızca bir ana kategoriye bağlanabilir. Alt kategorisi olan bir kategori başka kategoriye taşınamaz." }, { status: 400 });
    }
    if (items.some(item => item.id !== id && item.parentId === parentId && String(item.name).toLocaleLowerCase("tr") === name.toLocaleLowerCase("tr"))) {
      await tx.rollback(); return NextResponse.json({ error: "Bu başlık altında aynı isimli kategori zaten var." }, { status: 409 });
    }
    await tx.execute(editing
      ? { sql: "UPDATE categories SET name = ?, parent_id = ? WHERE id = ?", args: [name, parentId, id] }
      : { sql: "INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)", args: [id, name, parentId] });
    await tx.commit();
    return NextResponse.json({ id, categories: await loadCategories() }, { status: editing ? 200 : 201 });
  } catch { await tx.rollback(); return NextResponse.json({ error: "Kategori kaydedilemedi. Aynı başlıkta aynı isim kullanılıyor olabilir." }, { status: 409 }); }
  finally { tx.close(); }
}
export function POST(request: Request) { return save(request, false); }
export function PATCH(request: Request) { return save(request, true); }
