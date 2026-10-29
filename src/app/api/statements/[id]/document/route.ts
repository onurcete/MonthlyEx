import { NextResponse } from "next/server";
import { z } from "zod";
import { database, readStatementFile } from "@/lib/db";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  const db = await database();
  const exists = await db.execute({ sql: "SELECT id FROM statements WHERE id = ?", args: [id] });
  if (!exists.rows.length) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });
  const bytes = await readStatementFile(db, id);
  if (!bytes) return NextResponse.json({ error: "Belge dosyası bulunamadı." }, { status: 404 });
  const mime = bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf" : bytes[0] === 137 ? "image/png" : bytes[0] === 255 ? "image/jpeg" : "image/webp";
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": mime, "Content-Disposition": "inline", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
