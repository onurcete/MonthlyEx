import { NextResponse } from "next/server";
import { z } from "zod";
import { database, loadCategories } from "@/lib/db";
import { resolveCategory } from "@/lib/categories";
import { isSameOrigin } from "@/lib/request";
import { rememberCategory, replaceHistoricalMerchantCategory } from "@/lib/merchant-learning";

export const runtime = "nodejs";
const cardSchema = z.object({ type: z.literal("card"), name: z.string().trim().min(1).max(60), lastFour: z.string().regex(/^\d{4}$/) });
const expenseSchema = z.object({ type: z.literal("expense"), cardId: z.string().uuid(), date: z.iso.date(), merchant: z.string().trim().min(1).max(500), amount: z.number().int().positive().max(10000000000), category: z.string().min(1).max(200), kind: z.enum(["expense", "refund"]) });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "İstek kaynağı geçersiz." }, { status: 403 });
  const parsed = z.discriminatedUnion("type", [cardSchema, expenseSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Alanları kontrol edin. Tutar pozitif, tarih geçerli olmalı." }, { status: 400 });
  const value = parsed.data;
  const db = await database();
  const id = crypto.randomUUID();
  if (value.type === "card") {
    await db.execute({ sql: "INSERT INTO cards (id, name, last_four) VALUES (?, ?, ?)", args: [id, value.name, value.lastFour] });
  } else {
    const category = resolveCategory(await loadCategories(), value.category);
    if (!category) return NextResponse.json({ error: "Kategori bulunamadı." }, { status: 400 });
    const card = await db.execute({ sql: "SELECT id FROM cards WHERE id = ?", args: [value.cardId] });
    if (!card.rows.length) return NextResponse.json({ error: "Kart bulunamadı." }, { status: 400 });
    const tx = await db.transaction("write").catch(() => null);
    if (!tx) return NextResponse.json({ error: "Başka bir kayıt sürüyor. Tekrar deneyin." }, { status: 409 });
    try {
      await tx.execute({ sql: "INSERT INTO expenses (id, card_id, date, merchant, amount, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [id, value.cardId, value.date, value.merchant, value.amount, category.id, value.kind] });
      await rememberCategory(tx, id, value.merchant, category.id);
      await tx.commit();
    } catch { await tx.rollback(); return NextResponse.json({ error: "İşlem kaydedilemedi." }, { status: 500 }); }
    finally { tx.close(); }
  }
  return NextResponse.json({ id }, { status: 201 });
}
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "İstek kaynağı geçersiz." }, { status: 403 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz kayıt." }, { status: 400 });
  const db = await database();
  await db.batch([
    { sql: "DELETE FROM statement_expenses WHERE expense_id = ?", args: [parsed.data.id] },
    { sql: "DELETE FROM expenses WHERE id = ?", args: [parsed.data.id] },
  ], "write");
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "İstek kaynağı geçersiz." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 512 * 1024) return NextResponse.json({ error: "İstek çok büyük." }, { status: 413 });
  const parsed = z.object({
    edits: z.array(z.object({ id: z.uuid(), category: z.string().min(1).max(200), expectedCategory: z.string().min(1).max(200) })).min(1).max(2000),
    replaceHistory: z.boolean().optional(),
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data.edits.map(item => item.id)).size !== parsed.data.edits.length) return NextResponse.json({ error: "İşlemleri ve kategorileri kontrol edin." }, { status: 400 });
  const categories = await loadCategories();
  const edits = parsed.data.edits.map(item => ({ ...item, category: resolveCategory(categories, item.category)?.id }));
  if (edits.some(item => !item.category)) return NextResponse.json({ error: "Güncel listeden kategori seçin." }, { status: 400 });
  const db = await database();
  const tx = await db.transaction("write").catch(() => null);
  if (!tx) return NextResponse.json({ error: "Başka bir kayıt sürüyor. Tekrar deneyin." }, { status: 409 });
  try {
    let historyUpdatedCount = 0;
    for (const item of edits) {
      const current = await tx.execute({ sql: "SELECT merchant, category FROM expenses WHERE id = ?", args: [item.id] });
      if (!current.rows.length || current.rows[0].category !== item.expectedCategory) {
        await tx.rollback();
        return NextResponse.json({ error: "Bir işlem başka bir ekranda değişmiş veya silinmiş. Listeyi yenileyip tekrar deneyin." }, { status: 409 });
      }
      await tx.execute({ sql: "UPDATE expenses SET category = ? WHERE id = ?", args: [item.category!, item.id] });
      await rememberCategory(tx, item.id, String(current.rows[0].merchant), item.category!);
      if (parsed.data.replaceHistory) {
        historyUpdatedCount += await replaceHistoricalMerchantCategory(tx, String(current.rows[0].merchant), item.category!);
      }
    }
    await tx.commit();
    return NextResponse.json({ count: edits.length, historyUpdatedCount });
  } catch { await tx.rollback(); return NextResponse.json({ error: "Kategori değişiklikleri kaydedilemedi. Hiçbir işlem değiştirilmedi." }, { status: 500 }); }
  finally { tx.close(); }
}
