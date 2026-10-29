const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const swc = require("next/dist/build/swc");
const { randomUUID } = require("node:crypto");

// Load server-only TypeScript routes directly; external HTTP is always mocked.
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === "server-only") return {};
  if (name.startsWith("@/")) name = path.join(process.cwd(), "src", name.slice(2));
  return originalLoad.call(this, name, parent, isMain);
};
require.extensions[".ts"] = function (module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(swc.transformSync(source, { filename, jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" } }).code, filename);
};
process.env.DATABASE_URL = "file::memory:";
const { database } = require("../src/lib/db.ts");
const { analyzeDocument } = require("../src/lib/openai-analysis.ts");
const importRoute = require("../src/app/api/statements/[id]/import/route.ts");
const analyzeRoute = require("../src/app/api/statements/[id]/analyze/route.ts");
const recordRoute = require("../src/app/api/records/route.ts");
const statementRoute = require("../src/app/api/statements/[id]/route.ts");
const { parseStatementAmount } = require("../src/lib/statement-amount.ts");
const categoryRoute = require("../src/app/api/categories/route.ts");
const transactionRoute = require("../src/app/api/statements/[id]/transactions/route.ts");
const { buildAnalytics, buildCategoryRangeReport, buildMonthlyComparison, offsetMonth } = require("../src/lib/analytics.ts");
const { categoryLabel } = require("../src/lib/categories.ts");
const { loadCategories, loadData, backfillStatementPeriods } = require("../src/lib/db.ts");
const { expenseMonth, statementMonthFromAnalysis } = require("../src/lib/reporting-period.ts");
const { createExtractionSchema } = require("../src/lib/analysis-schema.ts");
const { applyCategoryTaxonomy } = require("../src/lib/category-migration.ts");
const { defaultCategories, categoryDefinitions } = require("../src/lib/types.ts");
const { merchantKey } = require("../src/lib/merchant.ts");
const { similarStatementMerchant, statementCategoryTargets } = require("../src/lib/statement-category.ts");
const { sortedStatementRows, isStatementRowIncluded } = require("../src/lib/statement-review.ts");
const { applyMerchantLearning, initializeMerchantLearning } = require("../src/lib/merchant-learning.ts");
const { changeCategoryDraft, categoryDraftEdits, clearSavedCategoryDrafts } = require("../src/lib/transaction-edits.ts");
const originalFetch = global.fetch;
const sampleRow = { date: "2026-10-20", merchant: "Test market", amount: 123456, currency: "TRY", category: "Market", kind: "expense", installment: "2/3", page: 1, needsReview: false };
const sample = { bank: "Test", lastFour: "1234", statementDate: "2026-10-24", dueDate: "2026-11-03", statementBalance: 150000, summary: "Test özeti", warnings: [], rows: [{ ...sampleRow, category: "default-0", sourceAmount: "1.234,56" }] };
function request(body) { return new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" }, body: JSON.stringify(body?.rows ? { month: "2026-10", ...body } : body) }); }
async function statement(status = "review") {
  const db = await database();
  const id = randomUUID();
  await db.execute({ sql: "INSERT INTO statements (id, name, created_at, status, hash) VALUES (?, 'test.pdf', ?, ?, ?)", args: [id, new Date().toISOString(), status, randomUUID()] });
  return id;
}
after(async () => {
  global.fetch = originalFetch;
  (await database()).close();
});

test("statement category assignment matches merchant variants but excludes unrelated shops, payments and FX", () => {
  assert.equal(similarStatementMerchant("MİGROS 1234 KADIKÖY", "Migros 5678 Şişli"), true);
  assert.equal(similarStatementMerchant("Kahve Dünyası Moda", "KAHVE DUNYASI ATAŞEHİR"), true);
  assert.equal(similarStatementMerchant("Onur Restoran POS123456", "ONUR RESTORAN POS987654"), true);
  assert.equal(similarStatementMerchant("Amazon Prime", "Amazon Marketplace"), false);
  assert.equal(similarStatementMerchant("İyzico Amazon", "IYZICO Trendyol"), false);
  assert.equal(similarStatementMerchant("Migros", "Migroskop Dergi"), false);
  assert.equal(similarStatementMerchant("12345", "67890"), false);
  const rows = [
    { ...sampleRow, merchant: "Migros Kadıköy" },
    { ...sampleRow, merchant: "MİGROS ŞİŞLİ", selected: false },
    { ...sampleRow, merchant: "Starbucks" },
    { ...sampleRow, merchant: "Migros", kind: "payment" },
    { ...sampleRow, merchant: "Migros", currency: "USD" },
    { ...sampleRow, merchant: "Migros", kind: "refund" },
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual(statementCategoryTargets(rows, [0]), [0, 1, 5]);
  assert.deepEqual(statementCategoryTargets(rows, [0, 2]), [0, 1, 2, 5]);
  assert.deepEqual(statementCategoryTargets(rows, [3, 4, 999]), []);
  assert.equal(JSON.stringify(rows), before);
});

test("statement uploads preserve chosen display names, UUID storage, duplicate protection and legacy file names", async () => {
  const uploadRoute = require("../src/app/api/statements/route.ts");
  const db = await database();
  const bytes = `%PDF-${randomUUID()}`;
  const uploaded = [];
  function uploadRequest(name, contents = bytes) {
    const form = new FormData();
    form.set("file", new File([contents], "original.pdf", { type: "application/pdf" }));
    if (name !== undefined) form.set("name", name);
    return new Request("http://localhost/api/statements", { method: "POST", headers: { host: "localhost", origin: "http://localhost" }, body: form });
  }
  try {
    assert.equal((await uploadRoute.POST(uploadRequest("x".repeat(201)))).status, 400);
    assert.equal((await uploadRoute.POST(uploadRequest("bad\nname"))).status, 400);
    const response = await uploadRoute.POST(uploadRequest("  Axess · Ekim 2026  "));
    assert.equal(response.status, 201);
    const { id } = await response.json(); uploaded.push(id);
    assert.equal((await db.execute({ sql: "SELECT name FROM statements WHERE id = ?", args: [id] })).rows[0].name, "Axess · Ekim 2026");
    assert.equal(fs.readFileSync(path.join(process.cwd(), "data", "statements", id), "utf8"), bytes);
    assert.equal((await uploadRoute.POST(uploadRequest("Another name"))).status, 409);
    const legacy = await uploadRoute.POST(uploadRequest(undefined, `%PDF-${randomUUID()}`));
    assert.equal(legacy.status, 201);
    const legacyData = await legacy.json(); uploaded.push(legacyData.id);
    assert.equal((await db.execute({ sql: "SELECT name FROM statements WHERE id = ?", args: [legacyData.id] })).rows[0].name, "original.pdf");
  } finally {
    for (const id of uploaded) {
      fs.unlinkSync(path.join(process.cwd(), "data", "statements", id));
      await db.execute({ sql: "DELETE FROM statements WHERE id = ?", args: [id] });
    }
  }
});

test("statement sorting keeps original row identities for editing, deletion and grouping", () => {
  const rows = [
    { ...sampleRow, merchant: "Zebra", date: "2026-10-20", selected: true },
    { ...sampleRow, merchant: "Ada", date: "2026-10-22", selected: true },
    { ...sampleRow, merchant: "Çarşı", date: "2026-10-19", selected: false, needsReview: true },
  ];
  assert.deepEqual(sortedStatementRows(rows, "", false, "merchant-asc").map(item => item.index), [1, 2, 0]);
  assert.deepEqual(sortedStatementRows(rows, "", false, "merchant-desc").map(item => item.index), [0, 2, 1]);
  assert.deepEqual(sortedStatementRows(rows, "", false, "date-asc").map(item => item.index), [2, 0, 1]);
  assert.deepEqual(sortedStatementRows(rows, "", false, "date-desc").map(item => item.index), [1, 0, 2]);
  assert.deepEqual(sortedStatementRows(rows, "ÇARŞI", true, "merchant-asc").map(item => item.index), [2]);
  assert.equal(rows[0].merchant, "Zebra");
});

test("pre-save deletion excludes marked rows from records and learning, with reversible inclusion", async () => {
  const db = await database();
  const id = await statement();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Deletion preview', '1234')", args: [cardId] });
  const kept = { ...sampleRow, merchant: "Keep merchant", selected: true, rememberCategory: true };
  const deleted = { ...sampleRow, merchant: "Deleted merchant", selected: true, deleted: true, rememberCategory: true };
  const pending = { ...sampleRow, merchant: "Pending review", selected: false, needsReview: true };
  const candidates = [kept, deleted, pending, { ...kept, kind: "payment" }, { ...kept, currency: "USD" }];
  assert.deepEqual(candidates.filter(isStatementRowIncluded), [kept]);
  assert.equal(isStatementRowIncluded({ ...deleted, deleted: false }), true);
  assert.equal(isStatementRowIncluded({ ...pending, deleted: true }), false);
  assert.deepEqual(statementCategoryTargets([kept, { ...kept, deleted: true }], [0]), [0]);
  const result = await importRoute.POST(request({ cardId, rows: candidates.filter(isStatementRowIncluded) }), { params: Promise.resolve({ id }) });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).count, 1);
  const saved = await db.execute({ sql: "SELECT e.merchant FROM expenses e JOIN statement_expenses se ON se.expense_id = e.id WHERE se.statement_id = ?", args: [id] });
  assert.deepEqual(saved.rows.map(row => row.merchant), ["Keep merchant"]);
  assert.equal((await db.execute("SELECT expense_id FROM merchant_examples WHERE merchant_key = 'deleted merchant'")).rows.length, 0);
});

test("statement list totals use current linked expenses and refunds, keeping document balance separate", async () => {
  const db = await database();
  const id = await statement("imported");
  const pending = await statement("pending");
  const empty = await statement("imported");
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Statement totals', '1234')", args: [cardId] });
  await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, result) VALUES (?, ?)", args: [id, JSON.stringify({ ...sample, statementBalance: 450000 })] });
  for (const [kind, amount, linked] of [["expense", 100000, true], ["refund", 20000, true], ["expense", 999999, false]]) {
    const expenseId = randomUUID();
    await db.execute({ sql: "INSERT INTO expenses VALUES (?, ?, '2026-10-20', 'Total fixture', ?, 'default-0', ?)", args: [expenseId, cardId, amount, kind] });
    if (linked) await db.execute({ sql: "INSERT INTO statement_expenses VALUES (?, ?, 1, NULL)", args: [expenseId, id] });
  }
  const first = (await loadData()).statements;
  assert.equal(first.find(row => row.id === id).netSpending, 80000);
  assert.equal(first.find(row => row.id === id).statementBalance, 450000);
  assert.equal(first.find(row => row.id === pending).netSpending, null);
  assert.equal(first.find(row => row.id === pending).statementBalance, null);
  assert.equal(first.find(row => row.id === empty).netSpending, 0);
  assert.equal(Object.hasOwn(first.find(row => row.id === id), "analysisResult"), false);
  await db.execute({ sql: "UPDATE expenses SET amount = 5000 WHERE id IN (SELECT expense_id FROM statement_expenses WHERE statement_id = ?) AND kind = 'expense'", args: [id] });
  const changed = (await loadData()).statements.find(row => row.id === id);
  assert.equal(changed.netSpending, -15000);
  assert.equal(changed.statementBalance, 450000);
});

test("saved statement deletion requires explicit scoped IDs, preserves memory and supports deleting every row", async () => {
  const db = await database();
  const cardId = randomUUID();
  const id = await statement();
  const otherId = await statement();
  const context = { params: Promise.resolve({ id }) };
  const otherContext = { params: Promise.resolve({ id: otherId }) };
  const merchant = `Remember deleted ${randomUUID()}`;
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Saved row deletion', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, merchant, rememberCategory: true }, { ...sampleRow, merchant: 'Retain row' }] }), context);
  await importRoute.POST(request({ cardId, rows: [sampleRow] }), otherContext);
  const current = await (await transactionRoute.GET(request({}), context)).json();
  const other = await (await transactionRoute.GET(request({}), otherContext)).json();
  const target = current.rows.find(row => row.merchant === merchant);
  const keep = current.rows.filter(row => row.id !== target.id);
  const payload = { cardId, revision: current.revision, rows: keep, deletedIds: [target.id] };
  assert.equal((await transactionRoute.PUT(request({ ...payload, deletedIds: [] }), context)).status, 409);
  assert.equal((await transactionRoute.PUT(request({ ...payload, deletedIds: [other.rows[0].id] }), context)).status, 409);
  assert.equal((await transactionRoute.PUT(request({ ...payload, deletedIds: [target.id, target.id] }), context)).status, 409);
  assert.equal((await transactionRoute.PUT(request({ ...payload, rows: current.rows }), context)).status, 409);
  const removed = await transactionRoute.PUT(request(payload), context);
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).deletedCount, 1);
  assert.equal((await db.execute({ sql: 'SELECT id FROM expenses WHERE id = ?', args: [target.id] })).rows.length, 0);
  assert.equal((await db.execute({ sql: 'SELECT expense_id FROM statement_expenses WHERE expense_id = ?', args: [target.id] })).rows.length, 0);
  assert.equal((await applyMerchantLearning(db, { ...sample, rows: [{ ...sampleRow, merchant, category: 'default-9' }] })).rows[0].learning.source, 'learned');
  assert.equal((await transactionRoute.PUT(request(payload), context)).status, 409);
  const remaining = await (await transactionRoute.GET(request({}), context)).json();
  const all = await transactionRoute.PUT(request({ cardId, revision: remaining.revision, rows: [], deletedIds: remaining.rows.map(row => row.id) }), context);
  assert.equal(all.status, 200);
  assert.equal((await all.json()).deletedCount, 1);
  assert.deepEqual((await (await transactionRoute.GET(request({}), context)).json()).rows, []);
  assert.equal((await loadData()).statements.find(row => row.id === id).netSpending, 0);
  assert.equal((await (await transactionRoute.GET(request({}), otherContext)).json()).rows.length, 1);
});

test("saved row deletion and edits roll back together on database failure", async () => {
  const db = await database();
  const cardId = randomUUID();
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  const failMerchant = `Fail update ${randomUUID()}`;
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Deletion rollback', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, merchant: failMerchant }, { ...sampleRow, merchant: 'Delete rollback row', rememberCategory: true }] }), context);
  const current = await (await transactionRoute.GET(request({}), context)).json();
  const keep = current.rows.filter(row => row.merchant === failMerchant);
  const deletedIds = current.rows.filter(row => row.merchant !== failMerchant).map(row => row.id);
  await db.execute("CREATE TRIGGER fail_saved_edit BEFORE UPDATE ON expenses WHEN NEW.amount = 987654321 BEGIN SELECT RAISE(ABORT, 'test'); END");
  try {
    const result = await transactionRoute.PUT(request({ cardId, month: '2026-11', revision: current.revision, rows: keep.map(row => ({ ...row, amount: 987654321 })), deletedIds }), context);
    assert.equal(result.status, 500);
    const unchanged = await (await transactionRoute.GET(request({}), context)).json();
    assert.deepEqual(unchanged, current);
  } finally { await db.execute('DROP TRIGGER fail_saved_edit'); }
});

test("monthly comparison groups all root categories and cards by statement month, with filters and refunds", () => {
  const cards = [{ id: "card-a", name: "Banka A", lastFour: "1234" }, { id: "card-b", name: "Banka B", lastFour: "5678" }];
  const row = { id: "1", cardId: "card-a", date: "2026-09-25", reportingMonth: "2026-10", statementId: "s", merchant: "Market", amount: 10000, category: "default-0-sub-0", kind: "expense" };
  const rows = [row, { ...row, id: "2", amount: 15000, kind: "refund" }, { ...row, id: "3", cardId: "card-b", category: "default-1-sub-0", amount: 20000 }, { ...row, id: "4", statementId: null, reportingMonth: null, date: "2026-11-01", amount: 3000 }, { ...row, id: "5", reportingMonth: null, amount: 999999 }];
  const comparison = buildMonthlyComparison(rows, cards, defaultCategories, "2026-09", "2026-11", "category", "net");
  assert.equal(comparison.series.length, 10);
  assert.deepEqual(comparison.months.map(item => item.month), ["2026-09", "2026-10", "2026-11"]);
  const market = comparison.series.findIndex(item => item.id === "default-0");
  const food = comparison.series.findIndex(item => item.id === "default-1");
  assert.deepEqual(comparison.months.map(item => item.values[market]), [0, -5000, 3000]);
  assert.deepEqual(comparison.months.map(item => item.values[food]), [0, 20000, 0]);
  const byCard = buildMonthlyComparison(rows, cards, defaultCategories, "2026-10", "2026-10", "card", "spent");
  assert.deepEqual(byCard.months[0].values, [10000, 20000]);
  const filtered = buildMonthlyComparison(rows, cards, defaultCategories, "2026-10", "2026-10", "category", "refunds", "card-a", "default-0-sub-0");
  assert.equal(filtered.series.length, 1);
  assert.equal(filtered.months[0].values[0], 15000);
  const sparse = buildMonthlyComparison(rows, cards, defaultCategories, "2000-01", "2026-12", "card", "spent");
  assert.equal(sparse.compact, true);
  assert.deepEqual(sparse.months.map(item => item.month), ["2026-10", "2026-11"]);
});

test("category drafts retain independent changes and original versions until successfully saved", () => {
  let drafts = {};
  for (let index = 0; index < 10; index++) drafts = changeCategoryDraft(drafts, `row-${index}`, 'original', `category-${index}`);
  const snapshot = categoryDraftEdits(drafts);
  assert.equal(snapshot.length, 10);
  drafts = changeCategoryDraft(drafts, 'row-0', 'externally-changed', 'revised');
  assert.equal(drafts['row-0'].expectedCategory, 'original');
  drafts = clearSavedCategoryDrafts(drafts, [snapshot[0], snapshot[1]]);
  assert.equal(drafts['row-0'].category, 'revised');
  assert.equal(drafts['row-1'], undefined);
  assert.equal(categoryDraftEdits(drafts).length, 9);
  drafts = changeCategoryDraft(drafts, 'row-0', 'externally-changed', 'original');
  assert.equal(drafts['row-0'], undefined);
  assert.deepEqual(clearSavedCategoryDrafts(drafts, categoryDraftEdits(drafts)), {});
});

test("one save applies different categories to ten rows and their statement records", async () => {
  const db = await database();
  const cardId = randomUUID();
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Multiple categories', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: Array.from({ length: 10 }, (_, index) => ({ ...sampleRow, merchant: `Independent ${randomUUID()} ${index}` })) }), context);
  const before = await (await transactionRoute.GET(request({}), context)).json();
  const edits = before.rows.map((row, index) => ({ id: row.id, expectedCategory: row.category, category: index % 2 ? 'default-1-sub-1' : 'default-2-sub-0' }));
  const response = await recordRoute.PATCH(request({ edits }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).count, 10);
  const after = await (await transactionRoute.GET(request({}), context)).json();
  for (const edit of edits) {
    assert.equal(after.rows.find(row => row.id === edit.id).category, edit.category);
    assert.equal((await db.execute({ sql: 'SELECT category_id FROM merchant_examples WHERE expense_id = ?', args: [edit.id] })).rows[0].category_id, edit.category);
  }
});

test("transaction category edits update saved statement rows and learning, invalidating stale statement edits", async () => {
  const db = await database();
  const cardId = randomUUID();
  const id = await statement();
  const merchant = `Inline category ${randomUUID()}`;
  const context = { params: Promise.resolve({ id }) };
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Inline category', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, merchant }] }), context);
  const before = await (await transactionRoute.GET(request({}), context)).json();
  const row = before.rows[0];
  const result = await recordRoute.PATCH(request({ edits: [{ id: row.id, expectedCategory: row.category, category: 'default-1-sub-1' }] }));
  assert.equal(result.status, 200);
  const after = await (await transactionRoute.GET(request({}), context)).json();
  assert.equal(after.rows[0].category, 'default-1-sub-1');
  assert.equal(after.rows[0].amount, row.amount);
  assert.equal(after.rows[0].date, row.date);
  assert.equal(after.rows[0].rememberCategory, true);
  assert.notEqual(after.revision, before.revision);
  assert.equal((await transactionRoute.PUT(request({ cardId, revision: before.revision, rows: before.rows }), context)).status, 409);
  const learned = await applyMerchantLearning(db, { ...sample, rows: [{ ...sampleRow, merchant, category: 'default-9' }] });
  assert.equal(learned.rows[0].category, 'default-1-sub-1');
});

test("bulk category edits reject stale rows and roll back edits and learning on failure", async () => {
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Bulk category', '1234')", args: [cardId] });
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) await db.execute({ sql: "INSERT INTO expenses VALUES (?, ?, '2026-10-20', ?, 1000, 'default-0', 'expense')", args: [id, cardId, `Bulk ${id}`] });
  const edits = ids.map(id => ({ id, expectedCategory: 'default-0', category: 'default-1' }));
  const stale = await recordRoute.PATCH(request({ edits: [edits[0], { ...edits[1], expectedCategory: 'default-9' }] }));
  assert.equal(stale.status, 409);
  assert.equal((await db.execute({ sql: 'SELECT category FROM expenses WHERE id = ?', args: [ids[0]] })).rows[0].category, 'default-0');
  assert.equal((await db.execute({ sql: 'SELECT expense_id FROM merchant_examples WHERE expense_id = ?', args: [ids[0]] })).rows.length, 0);
  assert.equal((await recordRoute.PATCH(request({ edits: [edits[0], edits[0]] }))).status, 400);
  assert.equal((await recordRoute.PATCH(request({ edits: [{ ...edits[0], category: 'missing' }] }))).status, 400);
  await db.execute(`CREATE TRIGGER bulk_category_fail BEFORE UPDATE ON expenses WHEN NEW.id = '${ids[1]}' BEGIN SELECT RAISE(ABORT, 'test'); END`);
  try {
    assert.equal((await recordRoute.PATCH(request({ edits }))).status, 500);
    assert.equal((await db.execute({ sql: 'SELECT category FROM expenses WHERE id = ?', args: [ids[0]] })).rows[0].category, 'default-0');
    assert.equal((await db.execute({ sql: 'SELECT expense_id FROM merchant_examples WHERE expense_id = ?', args: [ids[0]] })).rows.length, 0);
  } finally { await db.execute('DROP TRIGGER bulk_category_fail'); }
  const ok = await recordRoute.PATCH(request({ edits }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).count, 2);
});

test("Responses request sends a PDF, strict schema and store:false; validates output", async () => {
  process.env.OPENAI_API_KEY = "unit-test-key";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content[0].type, "input_file");
    assert.equal(body.input[0].content[0].detail, "high");
    assert.ok(body.text.format.schema.properties.rows.items.required.includes("sourceAmount"));
    assert.match(body.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(sample) }] }], usage: { total_tokens: 10 } });
  };
  const result = await analyzeDocument(Buffer.from("%PDF-test"));
  assert.equal(result.analysis.rows[0].amount, 123456);
  global.fetch = async () => Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ ...sample, rows: [{ ...sampleRow, date: "2026-02-30" }] }) }] }] });
  await assert.rejects(analyzeDocument(Buffer.from("%PDF-test")), /doğrulanamadı/);
  global.fetch = async () => Response.json({ status: "incomplete" });
  await assert.rejects(analyzeDocument(Buffer.from("%PDF-test")), /tamamlanamadı/);
  global.fetch = async () => new Response("private upstream error", { status: 429 });
  await assert.rejects(analyzeDocument(Buffer.from("%PDF-test")), /kota/);
});

test("import preserves cents and source; repeat and concurrent imports cannot duplicate", async () => {
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Test card', '1234')", args: [cardId] });
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  const payload = { cardId, rows: [sampleRow, { ...sampleRow, amount: 1000, kind: "refund" }] };
  const results = await Promise.all([importRoute.POST(request(payload), context), importRoute.POST(request(payload), context)]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const expenses = await db.execute({ sql: "SELECT amount, kind FROM expenses WHERE card_id = ? ORDER BY amount DESC", args: [cardId] });
  assert.equal(expenses.rows.length, 2);
  assert.equal(expenses.rows[0].amount, 123456);
  assert.equal(expenses.rows[1].kind, "refund");
  const source = await db.execute({ sql: "SELECT * FROM statement_expenses WHERE statement_id = ?", args: [id] });
  assert.equal(source.rows[0].installment, "2/3");
  assert.equal((await importRoute.POST(request(payload), context)).status, 409);
  const deleted = await recordRoute.DELETE(request({ id: source.rows[0].expense_id }));
  assert.equal(deleted.status, 200);
});

test("import rejects payments, FX, invalid amounts and unknown cards without changing status", async () => {
  const db = await database();
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  for (const patch of [{ kind: "payment" }, { currency: "USD" }, { amount: -1 }, { amount: 1.5 }, { date: "2026-02-30" }, {}]) {
    assert.equal((await importRoute.POST(request({ cardId: randomUUID(), rows: [{ ...sampleRow, ...patch }] }), context)).status, 400);
  }
  const status = await db.execute({ sql: "SELECT status FROM statements WHERE id = ?", args: [id] });
  assert.equal(status.rows[0].status, "review");
});

test("missing key and concurrent analysis are rejected before external API calls", async () => {
  const id = await statement("pending");
  const context = { params: Promise.resolve({ id }) };
  delete process.env.OPENAI_API_KEY;
  assert.equal((await analyzeRoute.POST(request({}), context)).status, 503);
  process.env.OPENAI_API_KEY = "unit-test-key";
  const db = await database();
  await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, started_at, token) VALUES (?, ?, ?)", args: [id, Date.now(), randomUUID()] });
  global.fetch = () => { throw new Error("Must not call OpenAI"); };
  assert.equal((await analyzeRoute.POST(request({}), context)).status, 409);
  const crossOrigin = new Request("http://localhost/api", { method: "POST", headers: { host: "localhost", origin: "http://example.com" } });
  assert.equal((await analyzeRoute.POST(crossOrigin, context)).status, 403);
});

test("analysis reads an existing upload, persists result and reopens without a paid request", async () => {
  const id = await statement("pending");
  const context = { params: Promise.resolve({ id }) };
  const folder = path.join(process.cwd(), "data", "statements");
  fs.mkdirSync(folder, { recursive: true });
  const fixture = path.join(folder, id);
  fs.writeFileSync(fixture, "%PDF-test", { flag: "wx" });
  process.env.OPENAI_API_KEY = "unit-test-key";
  let calls = 0;
  global.fetch = async () => { calls++; return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(sample) }] }], usage: { total_tokens: 10 } }); };
  try {
    assert.equal((await analyzeRoute.POST(request({}), context)).status, 200);
    const saved = await analyzeRoute.GET(request({}), context);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), sample);
    assert.equal((await analyzeRoute.POST(request({}), context)).status, 409);
    assert.equal(calls, 1);
    const db = await database();
    const status = await db.execute({ sql: "SELECT status FROM statements WHERE id = ?", args: [id] });
    assert.equal(status.rows[0].status, "review");
  } finally { fs.unlinkSync(fixture); }
});

test("a database error during import rolls back both expenses and statement status", async () => {
  const db = await database();
  const id = await statement();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Rollback test', '1234')", args: [cardId] });
  await db.execute("CREATE TRIGGER test_import_failure BEFORE INSERT ON expenses WHEN NEW.merchant = 'FAIL' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    const result = await importRoute.POST(request({ cardId, rows: [sampleRow, { ...sampleRow, merchant: "FAIL" }] }), { params: Promise.resolve({ id }) });
    assert.equal(result.status, 500);
    const expenses = await db.execute({ sql: "SELECT * FROM expenses WHERE card_id = ?", args: [cardId] });
    assert.equal(expenses.rows.length, 0);
    const status = await db.execute({ sql: "SELECT status FROM statements WHERE id = ?", args: [id] });
    assert.equal(status.rows[0].status, "review");
  } finally { await db.execute("DROP TRIGGER test_import_failure"); }
});

test("statement amounts use exact cents and reject ambiguous numeric formats", () => {
  for (const [raw, cents] of [["1.234,56", 123456], ["1.234.567,89", 123456789], ["1234,56", 123456], ["0,01", 1], ["1.234,56+", 123456], ["-1.234,56", 123456], ["1234.56", 123456], ["1250", 125000]]) {
    assert.equal(parseStatementAmount(raw), cents);
  }
  for (const raw of ["1.234", "1,234", "12.34,56", "100,0", "TL 100,00", "0,00", "abc"]) assert.equal(parseStatementAmount(raw), null);
});

test("amount conversion mismatch is corrected from source text and flagged for review", async () => {
  process.env.OPENAI_API_KEY = "unit-test-key";
  global.fetch = async () => Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ ...sample, rows: [{ ...sample.rows[0], amount: 1234 }] }) }] }] });
  const result = await analyzeDocument(Buffer.from("%PDF-test"));
  assert.equal(result.analysis.rows[0].amount, 123456);
  assert.equal(result.analysis.rows[0].needsReview, true);
  assert.equal(result.analysis.rows[0].merchant, sampleRow.merchant);
  assert.equal(result.analysis.warnings.length, 1);
});

test("deleting a statement removes its file, analysis and every linked expense, preserving other records", async () => {
  const db = await database();
  const id = await statement();
  const otherId = await statement();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Delete test', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: [sampleRow, { ...sampleRow, kind: "refund" }] }), { params: Promise.resolve({ id }) });
  await importRoute.POST(request({ cardId, rows: [sampleRow] }), { params: Promise.resolve({ id: otherId }) });
  const manual = randomUUID();
  await db.execute({ sql: "INSERT INTO expenses VALUES (?, ?, '2026-10-20', 'Manual', 1000, 'Market', 'expense')", args: [manual, cardId] });
  await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, result) VALUES (?, ?)", args: [id, JSON.stringify(sample)] });
  const folder = path.join(process.cwd(), "data", "statements");
  fs.mkdirSync(folder, { recursive: true });
  const fixture = path.join(folder, id);
  fs.writeFileSync(fixture, "%PDF-test", { flag: "wx" });
  try {
    const deleted = await statementRoute.DELETE(request({}), { params: Promise.resolve({ id }) });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).count, 2);
    assert.equal(fs.existsSync(fixture), false);
    assert.equal(fs.readdirSync(folder).some(name => name.startsWith(`${id}.deleting-`)), false);
    for (const table of ["statements", "statement_analyses", "statement_expenses", "statement_periods"]) {
      const column = table === "statements" ? "id" : "statement_id";
      assert.equal((await db.execute({ sql: `SELECT * FROM ${table} WHERE ${column} = ?`, args: [id] })).rows.length, 0);
    }
    const remaining = await db.execute({ sql: "SELECT id FROM expenses WHERE card_id = ?", args: [cardId] });
    assert.equal(remaining.rows.length, 2);
    assert.ok(remaining.rows.some(row => row.id === manual));
    assert.equal((await statementRoute.DELETE(request({}), { params: Promise.resolve({ id }) })).status, 404);
  } finally { if (fs.existsSync(fixture)) fs.unlinkSync(fixture); }
});

test("statement deletion rejects invalid ids, foreign origins and active analyses; missing files are allowed", async () => {
  assert.equal((await statementRoute.DELETE(request({}), { params: Promise.resolve({ id: "../file" }) })).status, 400);
  const crossOrigin = new Request("http://localhost/api", { method: "DELETE", headers: { host: "localhost", origin: "http://example.com" } });
  assert.equal((await statementRoute.DELETE(crossOrigin, { params: Promise.resolve({ id: randomUUID() }) })).status, 403);
  const db = await database();
  const id = await statement("analyzing");
  await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, started_at) VALUES (?, ?)", args: [id, Date.now()] });
  assert.equal((await statementRoute.DELETE(request({}), { params: Promise.resolve({ id }) })).status, 409);
  await db.execute({ sql: "UPDATE statement_analyses SET started_at = 0 WHERE statement_id = ?", args: [id] });
  assert.equal((await statementRoute.DELETE(request({}), { params: Promise.resolve({ id }) })).status, 200);
});

test("statement deletion rolls back linked expenses on database failure and keeps the original file", async () => {
  const db = await database();
  const id = await statement();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Delete rollback', '1234')", args: [cardId] });
  await importRoute.POST(request({ cardId, rows: [sampleRow] }), { params: Promise.resolve({ id }) });
  await db.execute(`CREATE TRIGGER test_delete_failure BEFORE DELETE ON statements WHEN OLD.id = '${id}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  const fixture = path.join(process.cwd(), "data", "statements", id);
  fs.writeFileSync(fixture, "%PDF-test", { flag: "wx" });
  try {
    assert.equal((await statementRoute.DELETE(request({}), { params: Promise.resolve({ id }) })).status, 500);
    assert.equal(fs.existsSync(fixture), true);
    assert.equal((await db.execute({ sql: "SELECT * FROM statement_expenses WHERE statement_id = ?", args: [id] })).rows.length, 1);
    assert.equal((await db.execute({ sql: "SELECT * FROM expenses WHERE card_id = ?", args: [cardId] })).rows.length, 1);
  } finally { await db.execute("DROP TRIGGER test_delete_failure"); fs.unlinkSync(fixture); }
});

test("custom category hierarchy supports renaming without losing historical assignments", async () => {
  const main = await categoryRoute.POST(request({ name: "Custom food", parentId: null }));
  assert.equal(main.status, 201);
  const mainId = (await main.json()).id;
  const child = await categoryRoute.POST(request({ name: "Custom supermarket", parentId: mainId }));
  assert.equal(child.status, 201);
  const childId = (await child.json()).id;
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Category test', '1234')", args: [cardId] });
  const statementId = await statement();
  const imported = await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, category: childId }] }), { params: Promise.resolve({ id: statementId }) });
  assert.equal(imported.status, 200);
  assert.equal((await categoryRoute.PATCH(request({ id: mainId, name: "Renamed food", parentId: null }))).status, 200);
  assert.equal((await categoryRoute.PATCH(request({ id: childId, name: "Renamed supermarket", parentId: mainId }))).status, 200);
  const categories = await loadCategories();
  assert.equal(categoryLabel(categories, childId), "Renamed food / Renamed supermarket");
  const saved = await db.execute({ sql: "SELECT category FROM expenses WHERE card_id = ?", args: [cardId] });
  assert.equal(saved.rows[0].category, childId);
  assert.equal(createExtractionSchema(categories).safeParse({ ...sample, rows: [{ ...sample.rows[0], category: childId }] }).success, true);
  assert.equal((await categoryRoute.POST(request({ name: "Renamed food", parentId: null }))).status, 409);
  assert.equal((await categoryRoute.POST(request({ name: "Too deep", parentId: childId }))).status, 400);
  assert.equal((await categoryRoute.PATCH(request({ id: mainId, name: "Cycle", parentId: childId }))).status, 400);
  assert.equal((await categoryRoute.PATCH(request({ id: childId, name: "Self", parentId: childId }))).status, 400);
});

test("editing saved statement updates actual records atomically without duplicating and rejects stale edits", async () => {
  const db = await database();
  const cardId = randomUUID();
  const newCardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Edit original', '1234')", args: [cardId] });
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Edit destination', '5678')", args: [newCardId] });
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  await importRoute.POST(request({ cardId, rows: [sampleRow] }), context);
  const current = await (await transactionRoute.GET(request({}), context)).json();
  const expenseId = current.rows[0].id;
  const payload = { cardId: newCardId, revision: current.revision, rows: [{ ...current.rows[0], amount: 54321, date: "2026-09-10", merchant: "Corrected description", category: "default-1", kind: "refund" }] };
  const edited = await transactionRoute.PUT(request(payload), context);
  assert.equal(edited.status, 200);
  const saved = await (await transactionRoute.GET(request({}), context)).json();
  assert.equal(saved.rows.length, 1);
  assert.equal(saved.rows[0].id, expenseId);
  assert.equal(saved.rows[0].amount, 54321);
  assert.equal(saved.rows[0].merchant, "Corrected description");
  assert.equal(saved.rows[0].date, "2026-09-10");
  assert.equal(saved.rows[0].category, "default-1");
  assert.equal(saved.rows[0].kind, "refund");
  assert.equal(saved.rows[0].cardId, newCardId);
  assert.equal(saved.rows[0].installment, "2/3");
  assert.equal((await transactionRoute.PUT(request(payload), context)).status, 409);
  assert.equal((await transactionRoute.PUT(request({ ...payload, revision: saved.revision, rows: [{ ...saved.rows[0], id: randomUUID() }] }), context)).status, 409);
  assert.equal((await transactionRoute.PUT(request({ ...payload, revision: saved.revision, rows: [{ ...saved.rows[0], category: "unknown-category" }] }), context)).status, 400);
  const remaining = await db.execute({ sql: "SELECT COUNT(*) AS count FROM expenses WHERE id = ?", args: [expenseId] });
  assert.equal(remaining.rows[0].count, 1);
});

test("overview aggregates subcategories, refunds and months correctly, including negative net and leap days", () => {
  const categories = [{ id: "food", name: "Food", parentId: null }, { id: "market", name: "Market", parentId: "food" }];
  const cards = [{ id: "card", name: "Card", lastFour: "1234" }];
  const base = { id: "a", cardId: "card", date: "2026-10-01", merchant: "Shop", amount: 3000, category: "market", kind: "expense" };
  const expenses = [base, { ...base, id: "b", category: "food", amount: 2000 }, { ...base, id: "c", amount: 1000, kind: "refund" }, { ...base, id: "d", date: "2026-09-20", amount: 10000 }];
  const report = buildAnalytics(expenses, cards, categories, "2026-10");
  assert.equal(report.spent, 5000);
  assert.equal(report.refunds, 1000);
  assert.equal(report.net, 4000);
  assert.equal(report.average, 2500);
  assert.equal(report.change, -60);
  assert.deepEqual(report.categoryTotals, [{ id: "food", name: "Food", amount: 5000 }]);
  assert.equal(report.daily[0].spent, 5000);
  assert.equal(report.daily.length, 1);
  assert.equal(report.cards[0].net, 4000);
  assert.equal(report.merchants[0].amount, 5000);
  assert.equal(report.trend.at(-2).spent, 10000);
  assert.equal(buildAnalytics([], cards, categories, "2024-02").daily.length, 29);
  assert.equal(buildAnalytics([{ ...base, amount: 9000, kind: "refund" }], cards, categories, "2026-10").net, -9000);
  assert.equal(offsetMonth("2026-01", -1), "2025-12");

  // Verify fixed vs variable & category comparison with MoM deltas
  const fixedCats = [
    ...categories,
    { id: "default-4", name: "Faturalar", parentId: null },
    { id: "default-4-sub-0", name: "Elektrik", parentId: "default-4" },
  ];
  const fvExpenses = [
    ...expenses,
    { ...base, id: "f1", date: "2026-10-05", merchant: "Enerjisa", amount: 1500, category: "default-4-sub-0", kind: "expense" },
    { ...base, id: "f0", date: "2026-09-05", merchant: "Enerjisa", amount: 1000, category: "default-4-sub-0", kind: "expense" },
  ];
  const fvReport = buildAnalytics(fvExpenses, cards, fixedCats, "2026-10");
  assert.equal(fvReport.fixedVsVariable.fixedSpent, 1500);
  assert.equal(fvReport.fixedVsVariable.prevFixedSpent, 1000);
  assert.equal(fvReport.fixedVsVariable.fixedChange, 50);
  assert.equal(fvReport.fixedVsVariable.variableSpent, 5000);
  assert.equal(fvReport.fixedVsVariable.prevVariableSpent, 10000);
  assert.equal(fvReport.fixedVsVariable.variableChange, -50);
  const foodComp = fvReport.categoryComparison.find(c => c.id === "food");
  assert.equal(foodComp.amount, 5000);
  assert.equal(foodComp.prevAmount, 10000);
  assert.equal(foodComp.pctChange, -50);
  assert.equal(foodComp.children.length, 2);
});

test("all September/October statement rows report in October, preserving their actual dates", async () => {
  const db = await database();
  const cardId = randomUUID();
  const statementId = await statement();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Period test', '1234')", args: [cardId] });
  const context = { params: Promise.resolve({ id: statementId }) };
  const imported = await importRoute.POST(request({ cardId, month: "2026-10", rows: [
    { ...sampleRow, date: "2026-09-25", amount: 10000 },
    { ...sampleRow, date: "2026-10-25", amount: 20000 },
    { ...sampleRow, date: "2026-09-26", amount: 1000, kind: "refund" },
  ] }), context);
  assert.equal(imported.status, 200);
  const data = await loadData();
  const records = data.expenses.filter(row => row.cardId === cardId);
  const report = buildAnalytics(records, data.cards, data.categories, "2026-10");
  assert.equal(report.spent, 30000);
  assert.equal(report.refunds, 1000);
  assert.equal(report.net, 29000);
  assert.equal(report.monthly.length, 3);
  assert.equal(buildAnalytics(records, data.cards, data.categories, "2026-09").monthly.length, 0);
  assert.equal(report.daily.find(row => row.date === "2026-09-25").spent, 10000);
  assert.equal(report.daily.find(row => row.date === "2026-10-25").spent, 20000);
  assert.equal(records.find(row => row.amount === 10000).date, "2026-09-25");
  assert.ok(records.every(row => row.reportingMonth === "2026-10"));
  const saved = await (await transactionRoute.GET(request({}), context)).json();
  assert.equal(saved.month, "2026-10");
  // Changing an individual transaction date must not change its reporting period.
  assert.equal((await transactionRoute.PUT(request({ cardId, month: "2026-10", revision: saved.revision, rows: saved.rows.map(row => ({ ...row, date: "2026-08-01" })) }), context)).status, 200);
  const updated = await (await transactionRoute.GET(request({}), context)).json();
  const changedPeriod = await transactionRoute.PUT(request({ cardId, month: "2026-11", revision: updated.revision, rows: updated.rows }), context);
  assert.equal(changedPeriod.status, 200);
  const refreshed = await loadData();
  const changedRows = refreshed.expenses.filter(row => row.cardId === cardId);
  assert.equal(buildAnalytics(changedRows, data.cards, data.categories, "2026-10").net, 0);
  assert.equal(buildAnalytics(changedRows, data.cards, data.categories, "2026-11").net, 29000);
  assert.equal((await transactionRoute.PUT(request({ cardId, month: "2026-12", revision: updated.revision, rows: updated.rows }), context)).status, 409);
});

test("legacy statement periods backfill from closing date, preserving explicit choices and excluding unknown periods", async () => {
  const db = await database();
  const known = await statement("imported");
  const explicit = await statement("imported");
  const unknown = await statement("imported");
  for (const id of [known, explicit, unknown]) {
    await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, result) VALUES (?, ?)", args: [id, JSON.stringify({ statementDate: id === unknown ? null : "2026-10-25", dueDate: "2026-11-04" })] });
  }
  await db.execute({ sql: "INSERT INTO statement_periods VALUES (?, '2026-12')", args: [explicit] });
  await backfillStatementPeriods(db);
  await backfillStatementPeriods(db);
  const result = await db.execute({ sql: "SELECT statement_id, month FROM statement_periods WHERE statement_id IN (?, ?, ?)", args: [known, explicit, unknown] });
  assert.equal(result.rows.find(row => row.statement_id === known).month, "2026-10");
  assert.equal(result.rows.find(row => row.statement_id === explicit).month, "2026-12");
  assert.equal(result.rows.some(row => row.statement_id === unknown), false);
  assert.equal(expenseMonth({ date: "2026-09-25", statementId: unknown, reportingMonth: null }), null);
  assert.equal(expenseMonth({ date: "2026-09-25" }), "2026-09");
  assert.equal(statementMonthFromAnalysis({ statementDate: "2026-02-30" }), null);
  assert.equal(statementMonthFromAnalysis({ statementDate: "2026-01-25", dueDate: "2026-02-04" }), "2026-01");
  const report = buildAnalytics([
    { id: "year-boundary", cardId: "card", date: "2025-12-26", reportingMonth: "2026-01", statementId: known, merchant: "Shop", amount: 5000, category: "default-0", kind: "expense" },
  ], [], [], "2026-01");
  assert.equal(report.net, 5000);
  assert.equal(report.previous.net, 0);
});

test("imports require an explicit valid statement month", async () => {
  for (const month of [undefined, "2026-00", "2026-13", "2026-1", "2026-10-25"]) {
    const result = await importRoute.POST(request({ cardId: randomUUID(), month, rows: [sampleRow] }), { params: Promise.resolve({ id: randomUUID() }) });
    assert.equal(result.status, 400);
  }
});

test("requested category definitions contain exactly ten roots and thirty-seven children", async () => {
  assert.equal(defaultCategories.filter(item => item.parentId === null).length, 10);
  assert.equal(defaultCategories.filter(item => item.parentId !== null).length, 37);
  assert.deepEqual(categoryDefinitions.map(item => item.name), ["Yeme & İçme", "Market & Günlük İhtiyaçlar", "Alışveriş", "Faturalar", "Abonelikler", "Ulaşım", "Sağlık & Kişisel Bakım", "Eğlence & Hobiler", "Seyahat", "Diğer"]);
  assert.ok(defaultCategories.some(item => item.name === "Tütün" && item.parentId === "default-0"));
  assert.equal(defaultCategories.filter(item => item.parentId === "default-9").length, 0);
  const dbCategories = await loadCategories();
  for (const item of defaultCategories) assert.ok(dbCategories.some(saved => saved.name === item.name && saved.parentId === item.parentId));
});

test("category taxonomy migration merges duplicates, preserves assignments, and runs only once", async () => {
  const { createClient } = require("@libsql/client");
  const db = createClient({ url: "file::memory:" });
  try {
    await db.batch([
      "CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES categories(id))",
      "CREATE UNIQUE INDEX category_names ON categories(COALESCE(parent_id, ''), name COLLATE NOCASE)",
      "CREATE TABLE expenses (id TEXT PRIMARY KEY, category TEXT NOT NULL)",
      "CREATE TABLE statement_analyses (statement_id TEXT PRIMARY KEY, result TEXT)",
      "INSERT INTO categories VALUES ('default-0', 'Market', NULL), ('default-1', 'Restoran / Kafe', NULL), ('default-8', 'Eğitim', NULL), ('default-9', 'Diğer', NULL), ('existing-food', 'Yeme & İçme', NULL), ('old-restaurant', 'Restoran', 'default-1'), ('existing-restaurant', 'Restoran', 'existing-food'), ('existing-fun', 'Eğlence & Hobiler', NULL), ('personal', 'Özel Kategori', NULL)",
      "INSERT INTO expenses VALUES ('a', 'default-1'), ('b', 'default-8'), ('c', 'default-0'), ('d', 'old-restaurant'), ('e', 'Market'), ('f', 'Eğitim')",
      { sql: "INSERT INTO statement_analyses VALUES ('statement', ?)", args: [JSON.stringify({ rows: [{ category: "default-8" }, { category: "old-restaurant" }, { category: "Restoran / Kafe" }] })] },
    ], "write");
    await applyCategoryTaxonomy(db);
    const categories = (await db.execute("SELECT id, name, parent_id AS parentId FROM categories")).rows;
    const expenses = (await db.execute("SELECT id, category FROM expenses")).rows;
    assert.equal(categories.filter(item => item.parentId === null).length, 11);
    assert.equal(categories.filter(item => item.name === "Yeme & İçme").length, 1);
    assert.equal(expenses.find(item => item.id === "a").category, "existing-food");
    assert.equal(expenses.find(item => item.id === "d").category, "existing-restaurant");
    assert.equal(expenses.find(item => item.id === "b").category, "default-9");
    assert.equal(expenses.find(item => item.id === "f").category, "default-9");
    assert.equal(expenses.find(item => item.id === "e").category, "default-0");
    assert.equal(categories.find(item => item.id === "existing-fun").name, "Eğlence & Hobiler");
    assert.ok(categories.some(item => item.id === "personal"));
    const analysis = JSON.parse((await db.execute("SELECT result FROM statement_analyses")).rows[0].result);
    assert.deepEqual(analysis.rows.map(item => item.category), ["default-9", "existing-restaurant", "existing-food"]);
    await db.execute("UPDATE categories SET name = 'Kendi adım' WHERE id = 'existing-food'");
    await applyCategoryTaxonomy(db);
    assert.equal((await db.execute("SELECT name FROM categories WHERE id = 'existing-food'")).rows[0].name, "Kendi adım");
  } finally { db.close(); }
});

test("category range reports group roots and children by statement month and preserve negative net", () => {
  const categories = [{ id: "food", name: "Food", parentId: null }, { id: "coffee", name: "Coffee", parentId: "food" }, { id: "market", name: "Market", parentId: null }];
  const base = { id: "a", cardId: "card", merchant: "Shop", amount: 10000, category: "coffee", kind: "expense", date: "2025-12-25", statementId: "s", reportingMonth: "2026-01" };
  const rows = [base, { ...base, id: "b", date: "2026-01-25", reportingMonth: "2026-02", amount: 5000 }, { ...base, id: "c", reportingMonth: "2026-02", amount: 7000, kind: "refund" }, { ...base, id: "d", category: "market", amount: 20000 }, { ...base, id: "e", reportingMonth: null, amount: 99999 }];
  const all = buildCategoryRangeReport(rows, categories, "2026-01", "2026-03");
  assert.equal(all.spent, 35000);
  assert.equal(all.refunds, 7000);
  assert.equal(all.net, 28000);
  assert.equal(all.months.length, 3);
  assert.equal(all.months[0].spent, 30000);
  assert.equal(all.months[1].net, -2000);
  assert.equal(all.months[2].spent, 0);
  assert.equal(all.groups.find(item => item.id === "food").net, 8000);
  const filtered = buildCategoryRangeReport(rows, categories, "2026-01", "2026-02", "food", "sub");
  assert.equal(filtered.spent, 15000);
  assert.equal(filtered.groups.length, 1);
  assert.equal(filtered.groups[0].id, "coffee");
  assert.equal(filtered.groups[0].name, "Food / Coffee");
  assert.equal(buildCategoryRangeReport(rows, categories, "2026-01", "2026-02", "coffee").net, 8000);
  assert.throws(() => buildCategoryRangeReport(rows, categories, "2026-03", "2026-01"), /Geçerli/);
  assert.throws(() => buildCategoryRangeReport(rows, categories, "2026-00", "2026-01"), /Geçerli/);
});

test("merchant normalization tolerates case and punctuation but preserves branch and provider identity", () => {
  assert.equal(merchantKey("MİGROS - ŞUBE 123"), merchantKey("migros sube 123"));
  assert.equal(merchantKey("MIGROS"), merchantKey("Migros"));
  assert.notEqual(merchantKey("Migros Şube 123"), merchantKey("Migros Şube 124"));
  assert.notEqual(merchantKey("PAYTR * Migros"), merchantKey("Migros"));
  assert.equal(merchantKey("123456"), "");
  assert.equal(merchantKey("***"), "");
});

test("confirmed categories are learned locally; edits replace examples; conflicts require review; forgetting removes evidence", async () => {
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Learning test', '1234')", args: [cardId] });
  const merchant = `Learning Shop ${randomUUID()}`;
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  const source = { ...sampleRow, merchant, category: "default-0-sub-0", rememberCategory: true };
  assert.equal((await importRoute.POST(request({ cardId, rows: [source] }), context)).status, 200);
  const original = { ...sample, rows: [{ ...sample.rows[0], merchant, category: "default-3", needsReview: false }] };
  const learned = await applyMerchantLearning(db, original);
  assert.equal(learned.rows[0].category, "default-0-sub-0");
  assert.equal(learned.rows[0].learning.source, "learned");
  assert.equal(learned.rows[0].learning.examples, 1);
  assert.equal(learned.rows[0].learning.originalCategory, "default-3");
  const uncertain = await applyMerchantLearning(db, { ...original, rows: [{ ...original.rows[0], needsReview: true }] });
  assert.equal(uncertain.rows[0].needsReview, true);
  const current = await (await transactionRoute.GET(request({}), context)).json();
  assert.equal(current.rows[0].rememberCategory, true);
  const correction = await transactionRoute.PUT(request({ cardId, revision: current.revision, rows: current.rows.map(row => ({ ...row, category: "default-1-sub-0", rememberCategory: true })) }), context);
  assert.equal(correction.status, 200);
  const corrected = await applyMerchantLearning(db, learned);
  assert.equal(corrected.rows[0].category, "default-1-sub-0");
  assert.equal(corrected.rows[0].learning.examples, 1);
  const manual = await recordRoute.POST(request({ type: "expense", cardId, date: "2026-10-20", merchant, amount: 1000, category: "default-3-sub-0", kind: "expense" }));
  assert.equal(manual.status, 201);
  const manualId = (await manual.json()).id;
  const conflicting = await applyMerchantLearning(db, corrected);
  assert.equal(conflicting.rows[0].learning.source, "conflict");
  assert.equal(conflicting.rows[0].category, "default-3");
  assert.equal(conflicting.rows[0].needsReview, true);
  assert.equal(conflicting.rows[0].learning.examples, 2);
  const waitingId = await statement();
  await db.execute({ sql: "INSERT INTO statement_analyses (statement_id, result) VALUES (?, ?)", args: [waitingId, JSON.stringify(learned)] });
  const waiting = await (await analyzeRoute.GET(request({}), { params: Promise.resolve({ id: waitingId }) })).json();
  assert.equal(waiting.rows[0].learning.source, "conflict");
  assert.equal(waiting.rows[0].category, "default-3");
  assert.equal((await statementRoute.DELETE(request({}), context)).status, 200);
  assert.equal((await recordRoute.DELETE(request({ id: manualId }))).status, 200);
  const retained = await applyMerchantLearning(db, conflicting);
  assert.equal(retained.rows[0].category, "default-3");
  assert.equal(retained.rows[0].needsReview, true);
  assert.equal(retained.rows[0].learning.source, "conflict");
  assert.equal(retained.rows[0].learning.examples, 2);
});

test("unconfirmed AI categories are not training data and a saved selection can be forgotten", async () => {
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'No feedback loop', '1234')", args: [cardId] });
  const merchant = `AI only ${randomUUID()}`;
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, merchant }] }), context);
  const analysis = { ...sample, rows: [{ ...sample.rows[0], merchant, category: "default-3" }] };
  assert.equal((await applyMerchantLearning(db, analysis)).rows[0].learning, undefined);
  const current = await (await transactionRoute.GET(request({}), context)).json();
  await transactionRoute.PUT(request({ cardId, revision: current.revision, rows: current.rows.map(row => ({ ...row, category: "default-1", rememberCategory: true })) }), context);
  assert.equal((await applyMerchantLearning(db, analysis)).rows[0].category, "default-1");
  const updated = await (await transactionRoute.GET(request({}), context)).json();
  await transactionRoute.PUT(request({ cardId, revision: updated.revision, rows: updated.rows.map(row => ({ ...row, rememberCategory: false })) }), context);
  assert.equal((await applyMerchantLearning(db, analysis)).rows[0].learning, undefined);
});

test("historical learning bootstraps only manual entries and unique corrections, never unchanged or ambiguous AI rows", async () => {
  const { createClient } = require("@libsql/client");
  const db = createClient({ url: "file::memory:" });
  try {
    const originalRows = [
      { ...sampleRow, merchant: "Unchanged AI", category: "cat-a" },
      { ...sampleRow, merchant: "Old correction", category: "cat-a" },
      { ...sampleRow, merchant: "Ambiguous", category: "cat-a" },
      { ...sampleRow, merchant: "Ambiguous", category: "cat-b" },
    ];
    await db.batch([
      "CREATE TABLE app_migrations (id TEXT PRIMARY KEY)",
      "CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, parent_id TEXT)",
      "INSERT INTO categories VALUES ('cat-a', 'A', NULL), ('cat-b', 'B', NULL)",
      "CREATE TABLE expenses (id TEXT PRIMARY KEY, merchant TEXT, category TEXT, date TEXT, amount INTEGER, kind TEXT)",
      "CREATE TABLE statement_expenses (expense_id TEXT PRIMARY KEY, statement_id TEXT, source_page INTEGER)",
      "CREATE TABLE statement_analyses (statement_id TEXT PRIMARY KEY, result TEXT)",
      "INSERT INTO expenses VALUES ('manual', 'Old manual', 'cat-b', '2026-10-20', 123456, 'expense'), ('unchanged', 'Unchanged AI', 'cat-a', '2026-10-20', 123456, 'expense'), ('corrected', 'Old correction', 'cat-b', '2026-10-20', 123456, 'expense'), ('ambiguous', 'Ambiguous', 'cat-b', '2026-10-20', 123456, 'expense')",
      "INSERT INTO statement_expenses VALUES ('unchanged', 'statement', 1), ('corrected', 'statement', 1), ('ambiguous', 'statement', 1)",
      { sql: "INSERT INTO statement_analyses VALUES ('statement', ?)", args: [JSON.stringify({ ...sample, rows: originalRows })] },
    ], "write");
    await initializeMerchantLearning(db);
    const examples = (await db.execute("SELECT expense_id FROM merchant_examples ORDER BY expense_id")).rows;
    assert.deepEqual(examples.map(row => row.expense_id), ["corrected", "manual"]);
    await db.execute("DELETE FROM merchant_examples WHERE expense_id = 'manual'");
    await initializeMerchantLearning(db);
    assert.equal((await db.execute("SELECT * FROM merchant_examples WHERE expense_id = 'manual'")).rows.length, 0);
    await db.execute("DELETE FROM expenses WHERE id = 'corrected'");
    assert.equal((await db.execute("SELECT * FROM merchant_examples")).rows.length, 1);
  } finally { db.close(); }
});

test("deleting an entire statement preserves category memory for future statements", async () => {
  const db = await database();
  const cardId = randomUUID();
  const merchant = `Permanent memory ${randomUUID()}`;
  const id = await statement();
  const context = { params: Promise.resolve({ id }) };
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Persistent memory', '1234')", args: [cardId] });
  assert.equal((await importRoute.POST(request({ cardId, rows: [{ ...sampleRow, merchant, category: "default-1-sub-1", rememberCategory: true }] }), context)).status, 200);
  assert.equal((await statementRoute.DELETE(request({}), context)).status, 200);
  assert.equal((await db.execute({ sql: "SELECT id FROM expenses WHERE merchant = ?", args: [merchant] })).rows.length, 0);
  const next = await applyMerchantLearning(db, { ...sample, rows: [{ ...sample.rows[0], date: "2026-11-20", merchant, category: "default-9" }] });
  assert.equal(next.rows[0].category, "default-1-sub-1");
  assert.equal(next.rows[0].learning.source, "learned");
  assert.equal(next.rows[0].learning.examples, 1);
});

test("persistent-memory migration preserves legacy examples and removes only the expense cascade", async () => {
  const { createClient } = require("@libsql/client");
  const db = createClient({ url: "file::memory:" });
  try {
    await db.batch([
      "CREATE TABLE app_migrations (id TEXT PRIMARY KEY)",
      "INSERT INTO app_migrations VALUES ('merchant-learning-v1')",
      "CREATE TABLE categories (id TEXT PRIMARY KEY)",
      "INSERT INTO categories VALUES ('remembered')",
      "CREATE TABLE expenses (id TEXT PRIMARY KEY)",
      "INSERT INTO expenses VALUES ('legacy-expense')",
      "CREATE TABLE merchant_examples (expense_id TEXT PRIMARY KEY REFERENCES expenses(id) ON DELETE CASCADE, merchant_key TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), updated_at TEXT NOT NULL)",
      "CREATE INDEX merchant_examples_key ON merchant_examples(merchant_key)",
      "INSERT INTO merchant_examples VALUES ('legacy-expense', 'legacy shop', 'remembered', '2026-10-01')",
    ], "write");
    await initializeMerchantLearning(db);
    await initializeMerchantLearning(db);
    const keys = (await db.execute("PRAGMA foreign_key_list(merchant_examples)")).rows;
    assert.ok(keys.some(row => row.table === "categories"));
    assert.ok(!keys.some(row => row.table === "expenses"));
    await db.execute("DELETE FROM expenses WHERE id = 'legacy-expense'");
  const remembered = await applyMerchantLearning(db, { ...sample, rows: [{ ...sample.rows[0], merchant: "Legacy Shop" }] });
    assert.equal(remembered.rows[0].category, "remembered");
    assert.equal(remembered.rows[0].learning.examples, 1);
    assert.equal((await db.execute("SELECT updated_at FROM merchant_examples")).rows[0].updated_at, "2026-10-01");
  } finally { db.close(); }
});

test("branch-agnostic learning, historical category replacement, and adding new rows to imported statements", async () => {
  const db = await database();
  const cardId = randomUUID();
  await db.execute({ sql: "INSERT INTO cards VALUES (?, 'Branch learning test', '1234')", args: [cardId] });

  // 1. Import a statement with Starbucks Kadikoy as Restaurant (default-1-sub-0)
  const st1 = await statement();
  const ctx1 = { params: Promise.resolve({ id: st1 }) };
  assert.equal((await importRoute.POST(request({
    cardId,
    month: "2026-09",
    rows: [{ ...sampleRow, merchant: "STARBUCKS KADIKOY SUBE 1234", category: "default-1-sub-0", rememberCategory: true }],
  }), ctx1)).status, 200);

  // 2. Analyze a new statement with Starbucks Besiktas (different branch & POS number)
  const nextAnalysis = await applyMerchantLearning(db, {
    ...sample,
    rows: [{ ...sample.rows[0], merchant: "STARBUCKS BESIKTAS POS9876", category: "default-9" }],
  });
  assert.equal(nextAnalysis.rows[0].category, "default-1-sub-0");
  assert.equal(nextAnalysis.rows[0].learning.source, "learned");
  assert.equal(nextAnalysis.rows[0].learning.matchType, "similar");

  // 3. Import second statement and choose to replace historical Starbucks records with Cafe (default-1-sub-1)
  const st2 = await statement();
  const ctx2 = { params: Promise.resolve({ id: st2 }) };
  const importRes = await importRoute.POST(request({
    cardId,
    month: "2026-10",
    rows: [{ ...sampleRow, merchant: "STARBUCKS BESIKTAS POS9876", category: "default-1-sub-1", rememberCategory: true }],
    replaceHistoryMerchants: [{ merchant: "STARBUCKS BESIKTAS POS9876", category: "default-1-sub-1" }],
  }), ctx2);
  assert.equal(importRes.status, 200);
  const importJson = await importRes.json();
  assert.equal(importJson.historyUpdatedCount, 1);

  // Verify first statement's expense was also updated to Cafe and no conflict exists on future statements
  const st1Saved = await (await transactionRoute.GET(request({}), ctx1)).json();
  assert.equal(st1Saved.rows[0].category, "default-1-sub-1");
  const thirdAnalysis = await applyMerchantLearning(db, {
    ...sample,
    rows: [{ ...sample.rows[0], merchant: "STARBUCKS ATASEHIR", category: "default-9" }],
  });
  assert.equal(thirdAnalysis.rows[0].category, "default-1-sub-1");
  assert.equal(thirdAnalysis.rows[0].learning.source, "learned");

  // 4. Add a new manual row and update installment on an already imported statement
  const st2Saved = await (await transactionRoute.GET(request({}), ctx2)).json();
  const putRes = await transactionRoute.PUT(request({
    cardId,
    month: "2026-10",
    revision: st2Saved.revision,
    rows: [
      { ...st2Saved.rows[0], installment: "3/6" },
      { date: "2026-10-22", merchant: "Unutulan Satır", amount: 45000, currency: "TRY", category: "default-0", kind: "fee", installment: null, page: 1, needsReview: false, rememberCategory: true },
    ],
    deletedIds: [],
  }), ctx2);
  assert.equal(putRes.status, 200);
  const st2After = await (await transactionRoute.GET(request({}), ctx2)).json();
  assert.equal(st2After.rows.length, 2);
  assert.equal(st2After.rows.find(r => r.merchant === "STARBUCKS BESIKTAS POS9876").installment, "3/6");
  assert.ok(st2After.rows.some(r => r.merchant === "Unutulan Satır" && r.amount === 45000));
});
