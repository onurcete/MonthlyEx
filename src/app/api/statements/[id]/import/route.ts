import { NextResponse } from "next/server";
import { z } from "zod";
import { database, loadCategories } from "@/lib/db";
import { resolveCategory } from "@/lib/categories";
import { isSameOrigin } from "@/lib/request";
import { analysisRowSchema } from "@/lib/analysis-schema";
import { rememberCategory, replaceHistoricalMerchantCategory } from "@/lib/merchant-learning";

export const runtime = "nodejs";
const schema = z.object({
  cardId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  rows: z.array(analysisRowSchema.extend({ currency: z.literal("TRY"), kind: z.enum(["expense", "refund", "fee", "interest"]), rememberCategory: z.boolean().optional() })).min(1).max(2000),
  replaceHistoryMerchants: z.array(z.object({ merchant: z.string().min(1).max(500), category: z.string().min(1).max(200) })).max(500).optional(),
});
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  if (Number(request.headers.get("content-length")) > 3 * 1024 * 1024) return NextResponse.json({ error: "İstek çok büyük." }, { status: 413 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Kartı, ekstre ayını, tarihleri ve tutarları kontrol edin. Yalnızca TL harcama ve iadeler aktarılabilir." }, { status: 400 });
  const db = await database();
  const categories = await loadCategories();
  const rows = parsed.data.rows.map(row => ({ ...row, category: resolveCategory(categories, row.category)?.id }));
  if (rows.some(row => !row.category)) return NextResponse.json({ error: "Kategori bulunamadı. Güncel listeden kategori seçin." }, { status: 400 });
  const tx = await db.transaction("write").catch(() => null);
  if (!tx) return NextResponse.json({ error: "Başka bir kayıt işlemi sürüyor. Birkaç saniye sonra yeniden deneyin." }, { status: 409 });
  try {
    const card = await tx.execute({ sql: "SELECT id FROM cards WHERE id = ?", args: [parsed.data.cardId] });
    if (!card.rows.length) { await tx.rollback(); return NextResponse.json({ error: "Kart bulunamadı." }, { status: 400 }); }
    const claim = await tx.execute({ sql: "UPDATE statements SET status = 'imported' WHERE id = ? AND status = 'review' RETURNING id", args: [id] });
    if (!claim.rows.length) { await tx.rollback(); return NextResponse.json({ error: "Belge aktarılmış veya analiz incelemeye hazır değil." }, { status: 409 }); }
    await tx.execute({ sql: "INSERT INTO statement_periods (statement_id, month) VALUES (?, ?) ON CONFLICT(statement_id) DO UPDATE SET month = excluded.month", args: [id, parsed.data.month] });
    let historyUpdatedCount = 0;
    if (parsed.data.replaceHistoryMerchants?.length) {
      for (const item of parsed.data.replaceHistoryMerchants) {
        const catId = resolveCategory(categories, item.category)?.id;
        if (catId) historyUpdatedCount += await replaceHistoricalMerchantCategory(tx, item.merchant, catId);
      }
    }
    for (const row of rows) {
      const expenseId = crypto.randomUUID();
      await tx.execute({ sql: "INSERT INTO expenses (id, card_id, date, merchant, amount, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [expenseId, parsed.data.cardId, row.date, row.merchant, row.amount, row.category!, row.kind === "refund" ? "refund" : "expense"] });
      await tx.execute({ sql: "INSERT INTO statement_expenses (expense_id, statement_id, source_page, installment) VALUES (?, ?, ?, ?)", args: [expenseId, id, row.page, row.installment] });
      if (row.rememberCategory) await rememberCategory(tx, expenseId, row.merchant, row.category!);
    }
    await tx.commit();
    return NextResponse.json({ count: parsed.data.rows.length, month: parsed.data.month, historyUpdatedCount });
  } catch {
    await tx.rollback();
    return NextResponse.json({ error: "Aktarım tamamlanamadı. Hiçbir işlem kaydedilmedi." }, { status: 500 });
  } finally { tx.close(); }
}
