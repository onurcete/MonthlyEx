import "server-only";
import { createHash } from "node:crypto";

export const statementRecordsSql = `SELECT e.id, e.card_id AS cardId, e.date, e.merchant, e.amount, e.category, e.kind,
  se.source_page AS page, se.installment, EXISTS(SELECT 1 FROM merchant_examples m WHERE m.expense_id = e.id) AS rememberCategory FROM statement_expenses se JOIN expenses e ON e.id = se.expense_id
  WHERE se.statement_id = ? ORDER BY e.id`;
export function recordsRevision(rows: unknown[], month: string | null = null) {
  return createHash("sha256").update(JSON.stringify({ rows, month })).digest("hex");
}
