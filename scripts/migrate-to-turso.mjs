import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const localPath = process.env.LOCAL_DB_URL || "file:data/monthlyex.db";
const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const remoteToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;

if (!remoteUrl || remoteUrl.startsWith("file:")) {
  console.error(
    "Hata: Uzak Turso veritabanı adresi bulunamadı.\n" +
      "Kullanım: TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:push-to-turso"
  );
  process.exit(1);
}

async function main() {
  console.log(`Yerel veritabanı okunuyor: ${localPath}`);
  const local = createClient({ url: localPath });
  const remote = createClient({ url: remoteUrl, authToken: remoteToken });

  console.log("Uzak Turso veritabanında tablolar hazırlanıyor...");
  await remote.batch(
    [
      "CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, name TEXT NOT NULL, last_four TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), date TEXT NOT NULL, merchant TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), category TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('expense','refund')))",
      "CREATE TABLE IF NOT EXISTS statements (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, hash TEXT NOT NULL UNIQUE)",
      "CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date)",
      "CREATE TABLE IF NOT EXISTS statement_analyses (statement_id TEXT PRIMARY KEY REFERENCES statements(id), result TEXT, error TEXT, model TEXT, usage TEXT, started_at INTEGER NOT NULL DEFAULT 0, token TEXT)",
      "CREATE TABLE IF NOT EXISTS statement_expenses (expense_id TEXT PRIMARY KEY REFERENCES expenses(id), statement_id TEXT NOT NULL REFERENCES statements(id), source_page INTEGER NOT NULL, installment TEXT)",
      "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES categories(id))",
      "CREATE UNIQUE INDEX IF NOT EXISTS categories_name_parent ON categories(COALESCE(parent_id, ''), name COLLATE NOCASE)",
      "CREATE TABLE IF NOT EXISTS statement_periods (statement_id TEXT PRIMARY KEY REFERENCES statements(id), month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'))",
      "CREATE TABLE IF NOT EXISTS statement_files (statement_id TEXT PRIMARY KEY REFERENCES statements(id) ON DELETE CASCADE, data BLOB NOT NULL)",
      "CREATE TABLE IF NOT EXISTS merchant_examples (expense_id TEXT PRIMARY KEY, merchant_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS merchant_examples_key ON merchant_examples(merchant_key)",
    ],
    "write"
  );

  // 1. Categories (roots first, then subcategories)
  const categories = (await local.execute("SELECT id, name, parent_id FROM categories")).rows;
  const roots = categories.filter(r => r.parent_id === null);
  const subs = categories.filter(r => r.parent_id !== null);
  for (const row of [...roots, ...subs]) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO categories (id, name, parent_id) VALUES (?, ?, ?)",
      args: [row.id, row.name, row.parent_id],
    });
  }
  console.log(`✓ ${categories.length} kategori aktarıldı.`);

  // 2. Cards
  const cards = (await local.execute("SELECT id, name, last_four FROM cards")).rows;
  for (const row of cards) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO cards (id, name, last_four) VALUES (?, ?, ?)",
      args: [row.id, row.name, row.last_four],
    });
  }
  console.log(`✓ ${cards.length} kart aktarıldı.`);

  // 3. Statements
  const statements = (await local.execute("SELECT id, name, created_at, status, hash FROM statements")).rows;
  for (const row of statements) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO statements (id, name, created_at, status, hash) VALUES (?, ?, ?, ?, ?)",
      args: [row.id, row.name, row.created_at, row.status, row.hash],
    });
  }
  console.log(`✓ ${statements.length} ekstre kaydı aktarıldı.`);

  // 4. Statement Periods
  const periods = (await local.execute("SELECT statement_id, month FROM statement_periods")).rows;
  for (const row of periods) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO statement_periods (statement_id, month) VALUES (?, ?)",
      args: [row.statement_id, row.month],
    });
  }
  console.log(`✓ ${periods.length} ekstre dönemi aktarıldı.`);

  // 5. Statement Analyses
  const analyses = (
    await local.execute("SELECT statement_id, result, error, model, usage, started_at, token FROM statement_analyses")
  ).rows;
  for (const row of analyses) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO statement_analyses (statement_id, result, error, model, usage, started_at, token) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [row.statement_id, row.result, row.error, row.model, row.usage, row.started_at ?? 0, row.token],
    });
  }
  console.log(`✓ ${analyses.length} ekstre analizi aktarıldı.`);

  // 6. Expenses
  const expenses = (await local.execute("SELECT id, card_id, date, merchant, amount, category, kind FROM expenses")).rows;
  for (const row of expenses) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO expenses (id, card_id, date, merchant, amount, category, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [row.id, row.card_id, row.date, row.merchant, row.amount, row.category, row.kind],
    });
  }
  console.log(`✓ ${expenses.length} harcama/iade işlemi aktarıldı.`);

  // 7. Statement Expenses
  const statementExpenses = (
    await local.execute("SELECT expense_id, statement_id, source_page, installment FROM statement_expenses")
  ).rows;
  for (const row of statementExpenses) {
    await remote.execute({
      sql: "INSERT OR REPLACE INTO statement_expenses (expense_id, statement_id, source_page, installment) VALUES (?, ?, ?, ?)",
      args: [row.expense_id, row.statement_id, row.source_page, row.installment],
    });
  }
  console.log(`✓ ${statementExpenses.length} ekstre-işlem bağlantısı aktarıldı.`);

  // 8. Merchant Examples (Learning Memory)
  try {
    const examples = (
      await local.execute("SELECT expense_id, merchant_key, category_id, updated_at FROM merchant_examples")
    ).rows;
    for (const row of examples) {
      await remote.execute({
        sql: "INSERT OR REPLACE INTO merchant_examples (expense_id, merchant_key, category_id, updated_at) VALUES (?, ?, ?, ?)",
        args: [row.expense_id, row.merchant_key, row.category_id, row.updated_at],
      });
    }
    console.log(`✓ ${examples.length} öğrenilmiş iş yeri hafıza kaydı aktarıldı.`);
  } catch {
    console.log("ℹ Yerel veritabanında merchant_examples tablosu henüz yok, atlandı.");
  }

  // 9. Statement Files (from local data/statements/ folder or local statement_files table)
  let fileCount = 0;
  for (const stmt of statements) {
    const id = String(stmt.id);
    const diskFile = path.join(process.cwd(), "data", "statements", id);
    let bytes = null;
    if (fs.existsSync(diskFile)) {
      bytes = fs.readFileSync(diskFile);
    } else {
      try {
        const dbFile = await local.execute({ sql: "SELECT data FROM statement_files WHERE statement_id = ?", args: [id] });
        if (dbFile.rows[0]?.data) {
          bytes = Buffer.from(dbFile.rows[0].data);
        }
      } catch {
        // ignore
      }
    }
    if (bytes) {
      await remote.execute({
        sql: "INSERT OR REPLACE INTO statement_files (statement_id, data) VALUES (?, ?)",
        args: [id, new Uint8Array(bytes)],
      });
      fileCount++;
    }
  }
  console.log(`✓ ${fileCount} PDF/görsel ekstre dosyası Turso veritabanına aktarıldı.`);
  console.log("\nTamamlandı! Tüm yerel verileriniz ve PDF ekstreleriniz Turso'ya başarıyla taşındı.");

  local.close();
  remote.close();
}

main().catch(err => {
  console.error("Aktarım hatası:", err);
  process.exit(1);
});
