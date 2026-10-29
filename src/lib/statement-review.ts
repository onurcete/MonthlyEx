export type StatementSort = "merchant-asc" | "merchant-desc" | "date-asc" | "date-desc";
type ReviewRow = { merchant: string; date: string; needsReview: boolean; currency: string; kind: string; selected: boolean; deleted?: boolean };

export function isStatementRowIncluded(row: Pick<ReviewRow, "currency" | "kind" | "selected" | "deleted">) {
  return !row.deleted && row.selected && row.currency === "TRY" && row.kind !== "payment";
}

export function sortedStatementRows<T extends ReviewRow>(rows: T[], query: string, onlyReview: boolean, sort: StatementSort) {
  return rows.map((row, index) => ({ row, index }))
    .filter(({ row }) => row.merchant.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")) && (!onlyReview || row.needsReview))
    .sort((a, b) => {
      const result = sort.startsWith("merchant") ? a.row.merchant.localeCompare(b.row.merchant, "tr", { sensitivity: "base", numeric: true }) : a.row.date.localeCompare(b.row.date);
      return result * (sort.endsWith("desc") ? -1 : 1) || a.index - b.index;
    });
}
