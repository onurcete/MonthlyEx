import type { Expense } from "./types";

export function expenseMonth(expense: Pick<Expense, "date" | "reportingMonth" | "statementId">): string | null {
  // Linked expenses without an assigned statement period must not drift into
  // their transaction month. Manual expenses retain their actual month.
  return expense.reportingMonth ?? (expense.statementId ? null : expense.date.slice(0, 7));
}
export function statementMonthFromAnalysis(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("statementDate" in value)) return null;
  const date = value.statementDate;
  if (typeof date !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date.slice(0, 7) : null;
}
