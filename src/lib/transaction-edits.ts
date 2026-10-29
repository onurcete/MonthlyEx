export type CategoryEdit = { id: string; category: string; expectedCategory: string };
export type CategoryDrafts = Record<string, Omit<CategoryEdit, "id">>;

export function changeCategoryDraft(drafts: CategoryDrafts, id: string, savedCategory: string, category: string): CategoryDrafts {
  const expectedCategory = drafts[id]?.expectedCategory ?? savedCategory;
  const next = { ...drafts };
  if (category === expectedCategory) delete next[id];
  else next[id] = { category, expectedCategory };
  return next;
}
export function categoryDraftEdits(drafts: CategoryDrafts): CategoryEdit[] {
  return Object.entries(drafts).map(([id, edit]) => ({ id, ...edit }));
}
export function clearSavedCategoryDrafts(drafts: CategoryDrafts, saved: CategoryEdit[]): CategoryDrafts {
  const next = { ...drafts };
  for (const edit of saved) {
    if (next[edit.id]?.category === edit.category && next[edit.id]?.expectedCategory === edit.expectedCategory) delete next[edit.id];
  }
  return next;
}
