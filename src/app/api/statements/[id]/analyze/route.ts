import { NextResponse } from "next/server";
import { z } from "zod";
import { database, loadCategories, readStatementFile } from "@/lib/db";
import { isSameOrigin } from "@/lib/request";
import { analyzeDocument } from "@/lib/openai-analysis";
import { applyMerchantLearning } from "@/lib/merchant-learning";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  const db = await database();
  const result = await db.execute({ sql: "SELECT a.result, s.status FROM statement_analyses a JOIN statements s ON s.id = a.statement_id WHERE a.statement_id = ?", args: [id] });
  if (!result.rows[0]?.result) return NextResponse.json({ error: "Bu belgenin hazır analizi yok." }, { status: 404 });
  const analysis = JSON.parse(String(result.rows[0].result));
  return NextResponse.json(result.rows[0].status === "imported" ? analysis : await applyMerchantLearning(db, analysis), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY?.trim()) return NextResponse.json({ error: "OPENAI_API_KEY eksik. .env.local dosyasına anahtarı ekleyip sunucuyu yeniden başlatın." }, { status: 503 });
  const db = await database();
  const statement = await db.execute({ sql: "SELECT status FROM statements WHERE id = ?", args: [id] });
  if (!statement.rows.length) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });
  if (["review", "imported"].includes(String(statement.rows[0].status))) return NextResponse.json({ error: "Bu belge zaten analiz edildi. Sonucu görüntüleyebilirsiniz." }, { status: 409 });
  const token = crypto.randomUUID();
  // A lease allows retry after a crashed process without parallel paid requests.
  const claim = await db.execute({
    sql: "INSERT INTO statement_analyses (statement_id, started_at, token) VALUES (?, ?, ?) ON CONFLICT(statement_id) DO UPDATE SET started_at = excluded.started_at, token = excluded.token, error = NULL WHERE statement_analyses.result IS NULL AND statement_analyses.started_at < ? RETURNING statement_id",
    args: [id, Date.now(), token, Date.now() - 300000],
  });
  if (!claim.rows.length) return NextResponse.json({ error: "Analiz sürüyor. Kesintiye uğradıysa 5 dakika sonra yeniden deneyebilirsiniz." }, { status: 409 });
  await db.execute({ sql: "UPDATE statements SET status = 'analyzing' WHERE id = ?", args: [id] });
  try {
    const bytes = await readStatementFile(db, id);
    if (!bytes) throw new Error("Belge dosyası bulunamadı.");
    const result = await analyzeDocument(bytes, await loadCategories());
    const analysis = await applyMerchantLearning(db, result.analysis);
    await db.batch([
      { sql: "UPDATE statement_analyses SET result = ?, model = ?, usage = ?, error = NULL WHERE statement_id = ? AND token = ?", args: [JSON.stringify(analysis), result.model, result.usage, id, token] },
      { sql: "UPDATE statements SET status = 'review' WHERE id = ? AND EXISTS (SELECT 1 FROM statement_analyses WHERE statement_id = ? AND token = ?)", args: [id, id, token] },
    ], "write");
    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : "Belge okunamadı veya analiz kaydedilemedi. Tekrar deneyin.";
    await db.batch([
      { sql: "UPDATE statement_analyses SET error = ?, started_at = 0 WHERE statement_id = ? AND token = ?", args: [message, id, token] },
      { sql: "UPDATE statements SET status = 'failed' WHERE id = ? AND EXISTS (SELECT 1 FROM statement_analyses WHERE statement_id = ? AND token = ?)", args: [id, id, token] },
    ], "write");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
