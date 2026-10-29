import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { database } from "@/lib/db";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Geçersiz kaynak." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) return NextResponse.json({ error: "En fazla 20 MB yüklenebilir." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "En fazla 20 MB boyutunda bir PDF veya görsel seçin." }, { status: 400 });
  const requestedName = form?.get("name");
  if (requestedName !== null && requestedName !== undefined && typeof requestedName !== "string") return NextResponse.json({ error: "Geçerli bir kayıt adı girin." }, { status: 400 });
  const name = (requestedName?.trim() || file.name.slice(0, 200)).trim();
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) return NextResponse.json({ error: "Kayıt adı en fazla 200 karakter olmalı ve kontrol karakteri içermemeli." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const valid = bytes.subarray(0, 5).toString() === "%PDF-" || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) || (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP");
  if (!valid) return NextResponse.json({ error: "Desteklenen biçimler: PDF, PNG, JPEG ve WebP." }, { status: 400 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const db = await database();
  const existing = await db.execute({ sql: "SELECT id FROM statements WHERE hash = ?", args: [hash] });
  if (existing.rows.length) return NextResponse.json({ error: "Bu dosya daha önce yüklendi." }, { status: 409 });
  const id = randomUUID();
  const isVercel = Boolean(process.env.VERCEL);
  const folder = path.join(process.cwd(), "data", "statements");
  const target = path.join(folder, id);
  if (!isVercel) {
    await mkdir(folder, { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  try {
    await db.batch([
      { sql: "INSERT INTO statements (id, name, created_at, status, hash) VALUES (?, ?, ?, ?, ?)", args: [id, name, new Date().toISOString(), "pending", hash] },
      { sql: "INSERT INTO statement_files (statement_id, data) VALUES (?, ?)", args: [id, new Uint8Array(bytes)] },
    ], "write");
  } catch (error) {
    if (!isVercel) await unlink(target).catch(() => {});
    throw error;
  }
  return NextResponse.json({ id, message: "Dosya kaydedildi. Ekstre listesindeki AI ile analiz et düğmesiyle analizi başlatabilirsiniz." }, { status: 201 });
}
