import { NextResponse } from "next/server";
import { rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database } from "@/lib/db";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  const db = await database();
  const tx = await db.transaction("write").catch(() => null);
  if (!tx) return NextResponse.json({ error: "Başka bir kayıt işlemi sürüyor. Tekrar deneyin." }, { status: 409 });
  const original = path.join(process.cwd(), "data", "statements", id);
  const staged = `${original}.deleting-${crypto.randomUUID()}`;
  let moved = false;
  let count = 0;
  try {
    const statement = await tx.execute({ sql: "SELECT s.status, a.started_at FROM statements s LEFT JOIN statement_analyses a ON a.statement_id = s.id WHERE s.id = ?", args: [id] });
    if (!statement.rows.length) { await tx.rollback(); return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 }); }
    const file = statement.rows[0];
    if (file.status === "analyzing" && Number(file.started_at) > Date.now() - 300000) {
      await tx.rollback();
      return NextResponse.json({ error: "Analiz sürerken ekstre silinemez. Analiz tamamlandıktan sonra tekrar deneyin." }, { status: 409 });
    }
    const linked = await tx.execute({ sql: "SELECT expense_id FROM statement_expenses WHERE statement_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM statement_expenses WHERE statement_id = ?", args: [id] });
    for (const row of linked.rows) {
      const result = await tx.execute({ sql: "DELETE FROM expenses WHERE id = ?", args: [row.expense_id] });
      count += result.rowsAffected;
    }
    await tx.execute({ sql: "DELETE FROM statement_analyses WHERE statement_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM statement_periods WHERE statement_id = ?", args: [id] });
    await tx.execute({ sql: "DELETE FROM statements WHERE id = ?", args: [id] });
    try { await rename(original, staged); moved = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await tx.commit();
  } catch {
    await tx.rollback();
    if (moved) await rename(staged, original);
    return NextResponse.json({ error: "Ekstre silinemedi. Kayıtlar geri alındı; yeniden deneyin." }, { status: 500 });
  } finally { tx.close(); }
  if (moved) {
    try { await unlink(staged); }
    catch { return NextResponse.json({ count, warning: "Ekstre ve bağlı işlemler silindi, ancak arşiv dosyası temizlenemedi." }); }
  }
  return NextResponse.json({ count });
}
