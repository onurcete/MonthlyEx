import "server-only";
import type { Client } from "@libsql/client";
import type { Analysis, AnalysisRow } from "./analysis-schema";
import { merchantKey, type CategoryLearning } from "./merchant";
import { similarStatementMerchant } from "./statement-category";
import { resolveCategory } from "./categories";
import type { Category } from "./types";

type Executor = Pick<Client, "execute">;
export type LearnedRow = AnalysisRow & { learning?: CategoryLearning; rememberCategory?: boolean };
export type LearnedAnalysis = Omit<Analysis, "rows"> & { rows: LearnedRow[] };

export async function rememberCategory(db: Executor, expenseId: string, merchant: string, category: string) {
  const key = merchantKey(merchant);
  if (!key) { await db.execute({ sql: "DELETE FROM merchant_examples WHERE expense_id = ?", args: [expenseId] }); return; }
  await db.execute({
    sql: "INSERT INTO merchant_examples (expense_id, merchant_key, category_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(expense_id) DO UPDATE SET merchant_key = excluded.merchant_key, category_id = excluded.category_id, updated_at = excluded.updated_at",
    args: [expenseId, key, category, new Date().toISOString()],
  });
}

export async function initializeMerchantLearning(db: Client) {
  // expense_id identifies the original confirmation, but is deliberately not a
  // foreign key: deleting its financial record must not erase category memory.
  await db.execute("CREATE TABLE IF NOT EXISTS merchant_examples (expense_id TEXT PRIMARY KEY, merchant_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), updated_at TEXT NOT NULL)");
  await db.execute("CREATE INDEX IF NOT EXISTS merchant_examples_key ON merchant_examples(merchant_key)");
  const tx = await db.transaction("write");
  try {
    if (!(await tx.execute("SELECT id FROM app_migrations WHERE id = 'merchant-learning-persistent-v2'")).rows.length) {
      const foreignKeys = await tx.execute("PRAGMA foreign_key_list(merchant_examples)");
      if (foreignKeys.rows.some(row => row.table === "expenses")) {
        await tx.execute("CREATE TABLE merchant_examples_persistent (expense_id TEXT PRIMARY KEY, merchant_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), updated_at TEXT NOT NULL)");
        await tx.execute("INSERT INTO merchant_examples_persistent SELECT expense_id, merchant_key, category_id, updated_at FROM merchant_examples");
        await tx.execute("DROP TABLE merchant_examples");
        await tx.execute("ALTER TABLE merchant_examples_persistent RENAME TO merchant_examples");
        await tx.execute("CREATE INDEX merchant_examples_key ON merchant_examples(merchant_key)");
      }
      await tx.execute("INSERT INTO app_migrations VALUES ('merchant-learning-persistent-v2')");
    }
    if ((await tx.execute("SELECT id FROM app_migrations WHERE id = 'merchant-learning-v1'")).rows.length) { await tx.commit(); return; }
    const categories = (await tx.execute("SELECT id, name, parent_id AS parentId FROM categories")).rows as unknown as Category[];
    const records = await tx.execute(`SELECT e.id, e.merchant, e.category, e.date, e.amount, e.kind,
      se.statement_id, se.source_page, a.result FROM expenses e LEFT JOIN statement_expenses se ON se.expense_id = e.id
      LEFT JOIN statement_analyses a ON a.statement_id = se.statement_id`);
    const parsed = new Map<string, AnalysisRow[]>();
    for (const row of records.rows) {
      if (row.statement_id === null) { await rememberCategory(tx, String(row.id), String(row.merchant), String(row.category)); continue; }
      const id = String(row.statement_id);
      if (!parsed.has(id)) {
        try { const value = JSON.parse(String(row.result)); parsed.set(id, Array.isArray(value?.rows) ? value.rows : []); }
        catch { parsed.set(id, []); }
      }
      // Only an unambiguous difference from the original AI assignment counts
      // as a historical human correction. Do not bootstrap unchanged AI output.
      const original = parsed.get(id)!.filter(item => item && typeof item.merchant === "string" && item.currency === "TRY" && item.kind !== "payment" && item.date === row.date && item.amount === row.amount && item.page === row.source_page && merchantKey(item.merchant) === merchantKey(String(row.merchant)) && (item.kind === "refund" ? "refund" : "expense") === row.kind);
      if (original.length !== 1) continue;
      const category = resolveCategory(categories, original[0].category)?.id;
      if (category && category !== row.category) await rememberCategory(tx, String(row.id), String(row.merchant), String(row.category));
    }
    await tx.execute("INSERT INTO app_migrations VALUES ('merchant-learning-v1')");
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}

export async function applyMerchantLearning(db: Executor, analysis: Analysis): Promise<LearnedAnalysis> {
  const result = await db.execute("SELECT m.merchant_key, m.category_id, COUNT(*) AS samples FROM merchant_examples m JOIN categories c ON c.id = m.category_id GROUP BY m.merchant_key, m.category_id");
  const matches = new Map<string, { category: string; samples: number }[]>();
  const allEntries: { key: string; category: string; samples: number }[] = [];
  for (const row of result.rows) {
    const key = String(row.merchant_key);
    const entry = { category: String(row.category_id), samples: Number(row.samples) };
    const list = matches.get(key) ?? [];
    list.push(entry); matches.set(key, list);
    allEntries.push({ key, ...entry });
  }
  return { ...analysis, rows: analysis.rows.map((input: LearnedRow) => {
    const { learning, rememberCategory: _remember, ...value } = input;
    const row = { ...value, category: learning?.originalCategory ?? value.category, needsReview: learning?.originalNeedsReview ?? value.needsReview };
    if (row.kind === "payment" || row.currency !== "TRY") return row;
    const exactKey = merchantKey(row.merchant);
    let candidates = matches.get(exactKey);
    let matchType: "exact" | "similar" = "exact";
    if (!candidates?.length && exactKey) {
      // Fallback to branch/POS-agnostic similarity matching
      const similarByCategory = new Map<string, number>();
      for (const entry of allEntries) {
        if (similarStatementMerchant(row.merchant, entry.key)) {
          similarByCategory.set(entry.category, (similarByCategory.get(entry.category) ?? 0) + entry.samples);
        }
      }
      if (similarByCategory.size > 0) {
        candidates = [...similarByCategory.entries()].map(([category, samples]) => ({ category, samples }));
        matchType = "similar";
      }
    }
    if (!candidates?.length) return row;
    const info: CategoryLearning = {
      source: candidates.length === 1 ? "learned" : "conflict",
      examples: candidates.reduce((sum, item) => sum + item.samples, 0),
      originalCategory: row.category,
      originalNeedsReview: row.needsReview,
      learnedCategories: candidates.map(c => c.category),
      matchType,
    };
    return candidates.length === 1 ? { ...row, category: candidates[0].category, learning: info } : { ...row, needsReview: true, learning: info };
  }) };
}

export async function replaceHistoricalMerchantCategory(db: Executor, merchant: string, newCategoryId: string) {
  const targetKey = merchantKey(merchant);
  if (!targetKey) return 0;
  const expenses = await db.execute("SELECT id, merchant FROM expenses");
  let updated = 0;
  for (const row of expenses.rows) {
    if (similarStatementMerchant(merchant, String(row.merchant))) {
      await db.execute({ sql: "UPDATE expenses SET category = ? WHERE id = ?", args: [newCategoryId, row.id] });
      await rememberCategory(db, String(row.id), String(row.merchant), newCategoryId);
      updated++;
    }
  }
  const examples = await db.execute("SELECT expense_id, merchant_key FROM merchant_examples");
  for (const ex of examples.rows) {
    if (similarStatementMerchant(merchant, String(ex.merchant_key))) {
      await db.execute({ sql: "UPDATE merchant_examples SET category_id = ?, updated_at = ? WHERE expense_id = ?", args: [newCategoryId, new Date().toISOString(), ex.expense_id] });
    }
  }
  return updated;
}
