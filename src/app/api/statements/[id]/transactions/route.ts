import { NextResponse } from "next/server";
import { z } from "zod";
import { database, loadCategories } from "@/lib/db";
import { isSameOrigin } from "@/lib/request";
import { analysisRowSchema } from "@/lib/analysis-schema";
import { resolveCategory } from "@/lib/categories";
import { statementRecordsSql, recordsRevision } from "@/lib/statement-records";
import { rememberCategory, replaceHistoricalMerchantCategory } from "@/lib/merchant-learning";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const schema = z.object({
  cardId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  revision: z.string().length(64),
  rows: z.array(analysisRowSchema.extend({ id: z.uuid().optional(), kind: z.enum(["expense", "refund", "fee", "interest"]), currency: z.literal("TRY"), rememberCategory: z.boolean().optional() })).max(2000),
  deletedIds: z.array(z.uuid()).max(2000).default([]),
  replaceHistoryMerchants: z.array(z.object({ merchant: z.string().min(1).max(500), category: z.string().min(1).max(200) })).max(500).optional(),
});
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz ekstre." }, { status: 400 });
  const db = await database();
  const status = await db.execute({ sql: "SELECT s.status, p.month FROM statements s LEFT JOIN statement_periods p ON p.statement_id = s.id WHERE s.id = ?", args: [id] });
  if (status.rows[0]?.status !== "imported") return NextResponse.json({ error: "Kaydedilmiş ekstre bulunamadı." }, { status: 404 });
  const result = await db.execute({ sql: statementRecordsSql, args: [id] });
  const month = status.rows[0].month === null ? null : String(status.rows[0].month);
  return NextResponse.json({ month, revision: recordsRevision(result.rows, month), cardId: result.rows[0]?.cardId ?? null, rows: result.rows.map(row => ({ ...row, rememberCategory: Boolean(row.rememberCategory), currency: "TRY", needsReview: false })) }, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: Request, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz ekstre." }, { status: 400 });
  if (Number(request.headers.get("content-length")) > 3 * 1024 * 1024) return NextResponse.json({ error: "İstek çok büyük." }, { status: 413 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Tarih, tutar, kategori ve işlem türünü kontrol edin." }, { status: 400 });
  const categories = await loadCategories();
  const rows = parsed.data.rows.map(row => ({ ...row, category: resolveCategory(categories, row.category)?.id }));
  if (rows.some(row => !row.category)) return NextResponse.json({ error: "Güncel listeden kategori seçin." }, { status: 400 });
  const db = await database();
  const tx = await db.transaction("write").catch(() => null);
  if (!tx) return NextResponse.json({ error: "Başka bir kayıt sürüyor. Tekrar deneyin." }, { status: 409 });
  try {
    const statement = await tx.execute({ sql: "SELECT s.status, p.month FROM statements s LEFT JOIN statement_periods p ON p.statement_id = s.id WHERE s.id = ?", args: [id] });
    if (statement.rows[0]?.status !== "imported") { await tx.rollback(); return NextResponse.json({ error: "Kaydedilmiş ekstre bulunamadı." }, { status: 404 }); }
    const current = await tx.execute({ sql: statementRecordsSql, args: [id] });
    const existingRows = rows.filter((row): row is typeof row & { id: string } => Boolean(row.id));
    const newRows = rows.filter(row => !row.id);
    const ids = new Set(existingRows.map(row => row.id));
    const deletedIds = new Set(parsed.data.deletedIds);
    const allIds = new Set([...ids, ...deletedIds]);
    const currentMonth = statement.rows[0].month === null ? null : String(statement.rows[0].month);
    if (recordsRevision(current.rows, currentMonth) !== parsed.data.revision || ids.size !== existingRows.length || deletedIds.size !== parsed.data.deletedIds.length || allIds.size !== ids.size + deletedIds.size || allIds.size !== current.rows.length || current.rows.some(row => !allIds.has(String(row.id)))) {
      await tx.rollback(); return NextResponse.json({ error: "İşlemler başka bir ekranda değişti. Sonucu kapatıp yeniden açın." }, { status: 409 });
    }
    const card = await tx.execute({ sql: "SELECT id FROM cards WHERE id = ?", args: [parsed.data.cardId] });
    if (!card.rows.length) { await tx.rollback(); return NextResponse.json({ error: "Kart bulunamadı." }, { status: 400 }); }
    await tx.execute({ sql: "INSERT INTO statement_periods (statement_id, month) VALUES (?, ?) ON CONFLICT(statement_id) DO UPDATE SET month = excluded.month", args: [id, parsed.data.month] });
    let historyUpdatedCount = 0;
    if (parsed.data.replaceHistoryMerchants?.length) {
      for (const item of parsed.data.replaceHistoryMerchants) {
        const catId = resolveCategory(categories, item.category)?.id;
        if (catId) historyUpdatedCount += await replaceHistoricalMerchantCategory(tx, item.merchant, catId);
      }
    }
    for (const expenseId of deletedIds) {
      await tx.execute({ sql: "DELETE FROM statement_expenses WHERE statement_id = ? AND expense_id = ?", args: [id, expenseId] });
      await tx.execute({ sql: "DELETE FROM expenses WHERE id = ?", args: [expenseId] });
      // Category memory deliberately survives removal of the financial record.
    }
    for (const row of existingRows) {
      const previous = current.rows.find(item => item.id === row.id)!;
      const dbKind = row.kind === "refund" ? "refund" : "expense";
      await tx.execute({ sql: "UPDATE expenses SET card_id = ?, date = ?, merchant = ?, amount = ?, category = ?, kind = ? WHERE id = ?", args: [parsed.data.cardId, row.date, row.merchant, row.amount, row.category!, dbKind, row.id] });
      await tx.execute({ sql: "UPDATE statement_expenses SET installment = ? WHERE statement_id = ? AND expense_id = ?", args: [row.installment ?? null, id, row.id] });
      const remember = row.rememberCategory ?? (previous.category !== row.category || Boolean(previous.rememberCategory));
      if (remember) await rememberCategory(tx, row.id, row.merchant, row.category!);
      else await tx.execute({ sql: "DELETE FROM merchant_examples WHERE expense_id = ?", args: [row.id] });
    }
    for (const row of newRows) {
      const expenseId = crypto.randomUUID();
      const dbKind = row.kind === "refund" ? "refund" : "expense";
      await tx.execute({ sql: "INSERT INTO expenses (id, card_id, date, merchant, amount, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [expenseId, parsed.data.cardId, row.date, row.merchant, row.amount, row.category!, dbKind] });
      await tx.execute({ sql: "INSERT INTO statement_expenses (expense_id, statement_id, source_page, installment) VALUES (?, ?, ?, ?)", args: [expenseId, id, row.page ?? 1, row.installment ?? null] });
      if (row.rememberCategory) await rememberCategory(tx, expenseId, row.merchant, row.category!);
    }
    const updated = await tx.execute({ sql: statementRecordsSql, args: [id] });
    await tx.commit();
    return NextResponse.json({ count: rows.length, deletedCount: deletedIds.size, month: parsed.data.month, revision: recordsRevision(updated.rows, parsed.data.month), historyUpdatedCount });
  } catch { await tx.rollback(); return NextResponse.json({ error: "Değişiklikler kaydedilemedi. Hiçbir işlem değiştirilmedi." }, { status: 500 }); }
  finally { tx.close(); }
}
