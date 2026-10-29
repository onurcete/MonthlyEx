import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { database } from "@/lib/db";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Geçersiz belge." }, { status: 400 });
  const db = await database();
  const exists = await db.execute({ sql: "SELECT id FROM statements WHERE id = ?", args: [id] });
  if (!exists.rows.length) return NextResponse.json({ error: "Belge bulunamadı." }, { status: 404 });
  const bytes = await readFile(path.join(process.cwd(), "data", "statements", id)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Belge dosyası bulunamadı." }, { status: 404 });
  const mime = bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf" : bytes[0] === 137 ? "image/png" : bytes[0] === 255 ? "image/jpeg" : "image/webp";
  return new Response(bytes, { headers: { "Content-Type": mime, "Content-Disposition": "inline", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
