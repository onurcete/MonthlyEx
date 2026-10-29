import type { Card, Category, Expense } from "./types";
import { categoryLabel } from "./categories";
import { expenseMonth } from "./reporting-period";

export function offsetMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function totals(rows: Expense[]) {
  const spent = rows.filter(row => row.kind === "expense").reduce((sum, row) => sum + row.amount, 0);
  const refunds = rows.filter(row => row.kind === "refund").reduce((sum, row) => sum + row.amount, 0);
  return { spent, refunds, net: spent - refunds, count: rows.filter(row => row.kind === "expense").length };
}
export type CategoryMetric = "spent" | "refunds" | "net";
export function buildMonthlyComparison(expenses: Expense[], cards: Card[], categories: Category[], from: string, to: string, grouping: "category" | "card", metric: CategoryMetric, cardId = "", categoryId = "") {
  const selected = categories.find(item => item.id === categoryId);
  const roots = categories.filter(item => item.parentId === null);
  const categoryById = new Map(categories.map(item => [item.id, item]));
  const rootFor = (id: string) => categoryById.get(id)?.parentId ?? id;
  const rows = expenses.filter(row => {
    const key = expenseMonth(row);
    return key !== null && key >= from && key <= to && (!cardId || row.cardId === cardId) && (!selected || row.category === categoryId || categoryById.get(row.category)?.parentId === categoryId);
  });
  const ids = grouping === "card"
    ? cards.filter(card => !cardId || card.id === cardId).map(card => ({ id: card.id, name: `${card.name} · ${card.lastFour}` }))
    : roots.filter(root => !selected || root.id === rootFor(categoryId)).map(root => ({ id: root.id, name: root.name }));
  const seen = new Set(ids.map(item => item.id));
  for (const row of rows) {
    const id = grouping === "card" ? row.cardId : rootFor(row.category);
    if (!seen.has(id)) { ids.push({ id, name: grouping === "card" ? "Bilinmeyen kart" : categoryLabel(categories, id) }); seen.add(id); }
  }
  const monthCount = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  const compact = monthCount > 120;
  const months = compact ? [...new Set(rows.map(expenseMonth).filter((key): key is string => key !== null))].sort() : Array.from({ length: Math.max(0, monthCount) }, (_, index) => offsetMonth(from, index));
  const sums = new Map<string, number>();
  for (const row of rows) {
    const id = grouping === "card" ? row.cardId : rootFor(row.category);
    const value = metric === "spent" ? row.kind === "expense" ? row.amount : 0 : metric === "refunds" ? row.kind === "refund" ? row.amount : 0 : row.kind === "refund" ? -row.amount : row.amount;
    const key = `${expenseMonth(row)}\u0000${id}`;
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  return { series: ids, months: months.map(month => ({ month, values: ids.map(item => sums.get(`${month}\u0000${item.id}`) ?? 0) })), compact, hasData: rows.length > 0 };
}
export function buildCategoryRangeReport(expenses: Expense[], categories: Category[], from: string, to: string, selectedId = "", level: "main" | "sub" = "main") {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || from > to) throw new Error("Geçerli bir başlangıç ve bitiş ayı seçin.");
  const rows = expenses.filter(row => {
    const key = expenseMonth(row);
    const category = categories.find(item => item.id === row.category);
    return key !== null && key >= from && key <= to && (!selectedId || row.category === selectedId || category?.parentId === selectedId);
  });
  const groupRows = new Map<string, Expense[]>();
  for (const row of rows) {
    const category = categories.find(item => item.id === row.category);
    const id = level === "main" ? category?.parentId ?? row.category : row.category;
    const group = groupRows.get(id) ?? [];
    group.push(row); groupRows.set(id, group);
  }
  const groups = [...groupRows].map(([id, items]) => {
    const category = categories.find(item => item.id === id);
    return { id, name: categoryLabel(categories, id) + (level === "sub" && category?.parentId === null ? " (ana kategoriye kayıtlı)" : ""), ...totals(items) };
  });
  // Empty months are explicitly included for ordinary ranges. For very long
  // histories show recorded months so the UI does not create thousands of bars.
  const monthCount = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  const compact = monthCount > 120;
  const keys = compact ? [...new Set(rows.map(expenseMonth).filter((key): key is string => key !== null))].sort() : Array.from({ length: monthCount }, (_, index) => offsetMonth(from, index));
  return { ...totals(rows), rows, groups, compact, months: keys.map(month => ({ month, ...totals(rows.filter(row => expenseMonth(row) === month)) })) };
}
export function buildAnalytics(expenses: Expense[], cards: Card[], categories: Category[], month: string) {
  const monthly = expenses.filter(row => expenseMonth(row) === month);
  const current = totals(monthly);
  const previous = totals(expenses.filter(row => expenseMonth(row) === offsetMonth(month, -1)));
  const categoryTotals = new Map<string, number>();
  const merchantTotals = new Map<string, number>();
  for (const row of monthly.filter(row => row.kind === "expense")) {
    const item = categories.find(item => item.id === row.category);
    const rootId = item?.parentId ?? row.category;
    categoryTotals.set(rootId, (categoryTotals.get(rootId) ?? 0) + row.amount);
    merchantTotals.set(row.merchant, (merchantTotals.get(row.merchant) ?? 0) + row.amount);
  }
  const [year, number] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const prevMonthly = expenses.filter(row => expenseMonth(row) === offsetMonth(month, -1));
  const prevCategoryTotals = new Map<string, number>();
  const subCategoryTotals = new Map<string, { id: string; name: string; parentId: string | null; amount: number; count: number; prevAmount: number }>();
  const merchantStats = new Map<string, { name: string; amount: number; count: number; categoryId: string }>();
  const FIXED_ROOT_IDS = new Set(["default-4", "default-5"]);
  const FIXED_KEYWORDS = ["fatura", "abonelik", "aidat", "kira", "sigorta", "kredi", "vergi"];
  const isFixedCategory = (catId: string) => {
    const item = categories.find(c => c.id === catId);
    const rootId = item?.parentId ?? catId;
    if (FIXED_ROOT_IDS.has(rootId)) return true;
    const rootName = (categories.find(c => c.id === rootId)?.name ?? "").toLocaleLowerCase("tr");
    const subName = (item?.name ?? "").toLocaleLowerCase("tr");
    return FIXED_KEYWORDS.some(kw => rootName.includes(kw) || subName.includes(kw));
  };
  let fixedSpent = 0;
  let fixedCount = 0;
  let variableSpent = 0;
  let variableCount = 0;
  const fixedItems: { id: string; merchant: string; amount: number; date: string; category: string }[] = [];

  for (const row of prevMonthly.filter(row => row.kind === "expense")) {
    const item = categories.find(c => c.id === row.category);
    const rootId = item?.parentId ?? row.category;
    prevCategoryTotals.set(rootId, (prevCategoryTotals.get(rootId) ?? 0) + row.amount);
    const prevSub = subCategoryTotals.get(row.category);
    if (prevSub) prevSub.prevAmount += row.amount;
    else subCategoryTotals.set(row.category, { id: row.category, name: item?.name ?? categoryLabel(categories, row.category), parentId: item?.parentId ?? null, amount: 0, count: 0, prevAmount: row.amount });
  }

  for (const row of monthly.filter(row => row.kind === "expense")) {
    const item = categories.find(c => c.id === row.category);
    const rootId = item?.parentId ?? row.category;
    const sub = subCategoryTotals.get(row.category);
    if (sub) { sub.amount += row.amount; sub.count += 1; }
    else subCategoryTotals.set(row.category, { id: row.category, name: item?.name ?? categoryLabel(categories, row.category), parentId: item?.parentId ?? null, amount: row.amount, count: 1, prevAmount: 0 });

    const m = merchantStats.get(row.merchant);
    if (m) { m.amount += row.amount; m.count += 1; }
    else merchantStats.set(row.merchant, { name: row.merchant, amount: row.amount, count: 1, categoryId: rootId });

    if (isFixedCategory(row.category)) {
      fixedSpent += row.amount;
      fixedCount += 1;
      fixedItems.push({ id: row.id, merchant: row.merchant, amount: row.amount, date: row.date, category: row.category });
    } else {
      variableSpent += row.amount;
      variableCount += 1;
    }
  }

  let prevFixedSpent = 0;
  let prevVariableSpent = 0;
  for (const row of prevMonthly.filter(row => row.kind === "expense")) {
    if (isFixedCategory(row.category)) prevFixedSpent += row.amount;
    else prevVariableSpent += row.amount;
  }

  const dates = monthly.length ? [...new Set(monthly.map(row => row.date))].sort() : Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return {
    ...current, monthly, previous,
    average: current.count ? Math.round(current.spent / current.count) : 0,
    change: previous.net > 0 ? (current.net - previous.net) / previous.net * 100 : null,
    spentChange: previous.spent > 0 ? (current.spent - previous.spent) / previous.spent * 100 : null,
    fixedVsVariable: {
      fixedSpent,
      fixedCount,
      prevFixedSpent,
      fixedChange: prevFixedSpent > 0 ? (fixedSpent - prevFixedSpent) / prevFixedSpent * 100 : null,
      variableSpent,
      variableCount,
      prevVariableSpent,
      variableChange: prevVariableSpent > 0 ? (variableSpent - prevVariableSpent) / prevVariableSpent * 100 : null,
      fixedShare: current.spent > 0 ? fixedSpent / current.spent * 100 : 0,
      variableShare: current.spent > 0 ? variableSpent / current.spent * 100 : 0,
      topFixed: fixedItems.sort((a, b) => b.amount - a.amount).slice(0, 6),
    },
    categoryComparison: categories.filter(c => c.parentId === null).map(root => {
      const amount = categoryTotals.get(root.id) ?? 0;
      const prevAmount = prevCategoryTotals.get(root.id) ?? 0;
      const diff = amount - prevAmount;
      const pctChange = prevAmount > 0 ? diff / prevAmount * 100 : null;
      const count = monthly.filter(r => r.kind === "expense" && (r.category === root.id || categories.find(c => c.id === r.category)?.parentId === root.id)).length;
      const isFixed = FIXED_ROOT_IDS.has(root.id) || FIXED_KEYWORDS.some(kw => root.name.toLocaleLowerCase("tr").includes(kw));
      const children = [...subCategoryTotals.values()].filter(sub => sub.parentId === root.id || (sub.id === root.id && sub.parentId === null)).sort((a, b) => b.amount - a.amount);
      return { id: root.id, name: root.name, amount, prevAmount, diff, pctChange, count, isFixed, share: current.spent > 0 ? amount / current.spent * 100 : 0, children };
    }).sort((a, b) => b.amount - a.amount || b.prevAmount - a.prevAmount),
    trend: Array.from({ length: 6 }, (_, index) => {
      const key = offsetMonth(month, index - 5);
      const mRows = expenses.filter(row => expenseMonth(row) === key);
      let mFixed = 0, mVar = 0;
      for (const r of mRows.filter(r => r.kind === "expense")) {
        if (isFixedCategory(r.category)) mFixed += r.amount;
        else mVar += r.amount;
      }
      return { month: key, ...totals(mRows), fixedSpent: mFixed, variableSpent: mVar };
    }),
    daily: dates.map(date => ({ date, day: Number(date.slice(8, 10)), ...totals(monthly.filter(row => row.date === date)) })),
    categoryTotals: [...categoryTotals].map(([id, amount]) => ({ id, name: categoryLabel(categories, id), amount })).sort((a, b) => b.amount - a.amount),
    merchants: [...merchantTotals].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5),
    merchantDetails: [...merchantStats.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    topExpenses: monthly.filter(row => row.kind === "expense").slice().sort((a, b) => b.amount - a.amount).slice(0, 5),
    cards: cards.map(card => ({ ...card, ...totals(monthly.filter(row => row.cardId === card.id)) })).filter(card => card.spent || card.refunds),
  };
}
