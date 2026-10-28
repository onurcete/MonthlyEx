import "server-only";
import { createClient, type Client } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppData } from "./types";

let ready: Promise<Client> | undefined;
export function database() {
  if (!ready) ready = initialize().catch(error => { ready = undefined; throw error; });
  return ready;
}
async function initialize() {
  const url = process.env.DATABASE_URL || "file:data/monthlyex.db";
  if (process.env.VERCEL && url.startsWith("file:")) throw new Error("Vercel için kalıcı uzak veritabanı yapılandırılmalı.");
  if (url.startsWith("file:")) await mkdir(path.dirname(path.resolve(url.slice(5))), { recursive: true });
  const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  await db.batch([
    "CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, last_four TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), date TEXT NOT NULL, merchant TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), category TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('expense','refund')))",
    "CREATE TABLE IF NOT EXISTS statements (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
    "CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date)"
  ], "write");
  return db;
}
export async function loadData(): Promise<AppData> {
  const db = await database();
  const [cards, expenses, statements] = await Promise.all([
    db.execute("SELECT id, name, last_four AS lastFour FROM cards ORDER BY name"),
    db.execute("SELECT id, card_id AS cardId, date, merchant, amount, category, kind FROM expenses ORDER BY date DESC, id"),
    db.execute("SELECT id, name, created_at AS createdAt, status FROM statements ORDER BY created_at DESC")
  ]);
  return { cards: cards.rows, expenses: expenses.rows, statements: statements.rows } as unknown as AppData;
}
