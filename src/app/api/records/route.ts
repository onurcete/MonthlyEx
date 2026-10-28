import { NextResponse } from "next/server";
import { z } from "zod";
import { database } from "@/lib/db";
import { categories } from "@/lib/types";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
const cardSchema = z.object({ type: z.literal("card"), name: z.string().trim().min(1).max(60), lastFour: z.string().regex(/^\d{4}$/) });
const expenseSchema = z.object({ type: z.literal("expense"), cardId: z.string().uuid(), date: z.iso.date(), merchant: z.string().trim().min(1).max(160), amount: z.number().int().positive().max(10000000000), category: z.enum(categories), kind: z.enum(["expense", "refund"]) });
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
    const card = await db.execute({ sql: "SELECT id FROM cards WHERE id = ?", args: [value.cardId] });
    if (!card.rows.length) return NextResponse.json({ error: "Kart bulunamadı." }, { status: 400 });
    await db.execute({ sql: "INSERT INTO expenses (id, card_id, date, merchant, amount, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?)", args: [id, value.cardId, value.date, value.merchant, value.amount, value.category, value.kind] });
  }
  return NextResponse.json({ id }, { status: 201 });
}
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "İstek kaynağı geçersiz." }, { status: 403 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz kayıt." }, { status: 400 });
  const db = await database();
  await db.execute({ sql: "DELETE FROM expenses WHERE id = ?", args: [parsed.data.id] });
  return NextResponse.json({ ok: true });
}
