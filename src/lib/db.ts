import "server-only";
import { createClient, type Client } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AppData, Category } from "./types";
import { statementMonthFromAnalysis } from "./reporting-period";
import { applyCategoryTaxonomy } from "./category-migration";
import { categoryOptions } from "./categories";
import { initializeMerchantLearning } from "./merchant-learning";

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
    "CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date)",
    "CREATE TABLE IF NOT EXISTS statement_analyses (statement_id TEXT PRIMARY KEY REFERENCES statements(id), result TEXT, error TEXT, model TEXT, usage TEXT, started_at INTEGER NOT NULL DEFAULT 0, token TEXT)",
    "CREATE TABLE IF NOT EXISTS statement_expenses (expense_id TEXT PRIMARY KEY REFERENCES expenses(id), statement_id TEXT NOT NULL REFERENCES statements(id), source_page INTEGER NOT NULL, installment TEXT)",
    "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES categories(id))",
    "CREATE UNIQUE INDEX IF NOT EXISTS categories_name_parent ON categories(COALESCE(parent_id, ''), name COLLATE NOCASE)",
    "CREATE TABLE IF NOT EXISTS statement_periods (statement_id TEXT PRIMARY KEY REFERENCES statements(id), month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'))"
  ], "write");
  await applyCategoryTaxonomy(db);
  // Migrate existing text labels to stable IDs, preserving historical categories.
  const old = await db.execute("SELECT DISTINCT category FROM expenses WHERE category NOT IN (SELECT id FROM categories)");
  for (const row of old.rows) {
    const name = String(row.category);
    const found = await db.execute({ sql: "SELECT id FROM categories WHERE name = ? AND parent_id IS NULL", args: [name] });
    const id = found.rows.length ? String(found.rows[0].id) : crypto.randomUUID();
    await db.batch([
      { sql: "INSERT OR IGNORE INTO categories (id, name, parent_id) VALUES (?, ?, NULL)", args: [id, name] },
      { sql: "UPDATE expenses SET category = ? WHERE category = ?", args: [id, name] },
    ], "write");
  }
  await backfillStatementPeriods(db);
  await initializeMerchantLearning(db);
  return db;
}
export async function backfillStatementPeriods(db: Client) {
  const missing = await db.execute("SELECT a.statement_id, a.result FROM statement_analyses a LEFT JOIN statement_periods p ON p.statement_id = a.statement_id WHERE p.statement_id IS NULL AND a.result IS NOT NULL");
  for (const row of missing.rows) {
    let month: string | null = null;
    try { month = statementMonthFromAnalysis(JSON.parse(String(row.result))); } catch { /* Leave unreadable periods for explicit user selection. */ }
    if (month) await db.execute({ sql: "INSERT OR IGNORE INTO statement_periods (statement_id, month) VALUES (?, ?)", args: [row.statement_id, month] });
  }
}
export async function loadCategories(): Promise<Category[]> {
  const db = await database();
  const result = await db.execute("SELECT id, name, parent_id AS parentId FROM categories ORDER BY name COLLATE NOCASE");
  return categoryOptions(result.rows as unknown as Category[]).map(({ label: _label, ...category }) => category);
}
export async function loadData(): Promise<AppData> {
  const db = await database();
  const [cards, expenses, statements] = await Promise.all([
    db.execute("SELECT id, name, last_four AS lastFour FROM cards ORDER BY name"),
    db.execute("SELECT e.id, e.card_id AS cardId, e.date, e.merchant, e.amount, e.category, e.kind, se.statement_id AS statementId, CASE WHEN se.statement_id IS NULL THEN SUBSTR(e.date, 1, 7) ELSE p.month END AS reportingMonth FROM expenses e LEFT JOIN statement_expenses se ON se.expense_id = e.id LEFT JOIN statement_periods p ON p.statement_id = se.statement_id ORDER BY e.date DESC, e.id"),
    db.execute(`SELECT s.id, s.name, s.created_at AS createdAt, s.status, a.error, p.month, a.result AS analysisResult,
      CASE WHEN s.status = 'imported' THEN COALESCE(t.total, 0) ELSE NULL END AS netSpending
      FROM statements s LEFT JOIN statement_analyses a ON a.statement_id = s.id LEFT JOIN statement_periods p ON p.statement_id = s.id
      LEFT JOIN (SELECT se.statement_id, SUM(CASE WHEN e.kind = 'refund' THEN -e.amount ELSE e.amount END) AS total
        FROM statement_expenses se JOIN expenses e ON e.id = se.expense_id GROUP BY se.statement_id) t ON t.statement_id = s.id
      ORDER BY s.created_at DESC`)
  ]);
  const statementRows = statements.rows.map(({ analysisResult, ...row }) => {
    let statementBalance: number | null = null;
    try {
      const value = JSON.parse(String(analysisResult))?.statementBalance;
      if (Number.isSafeInteger(value)) statementBalance = value;
    } catch { /* Legacy or incomplete analysis: no balance available yet. */ }
    return { ...row, statementBalance };
  });
  return { cards: cards.rows, expenses: expenses.rows, statements: statementRows, categories: await loadCategories() } as unknown as AppData;
}
