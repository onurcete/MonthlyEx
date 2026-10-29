import { categoryDefinitions, legacyCategoryIds, type Category } from "./types";

export function categoryLabel(categories: Category[], id: string): string {
  const item = categories.find(category => category.id === id);
  if (!item) return id;
  const parent = categories.find(category => category.id === item.parentId);
  return parent ? `${parent.name} / ${item.name}` : item.name;
}
export function categoryOptions(categories: Category[]) {
  const position = (item: Category) => {
    const index = categoryDefinitions.findIndex(definition => definition.id === item.id || definition.name === item.name);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return categories.filter(item => item.parentId === null).sort((a, b) => position(a) - position(b) || a.name.localeCompare(b.name, "tr")).flatMap(parent => {
    const definition = categoryDefinitions.find(item => item.id === parent.id || item.name === parent.name);
    const names: readonly string[] = definition?.children ?? [];
    const index = (item: Category) => names.includes(item.name) ? names.indexOf(item.name) : Number.MAX_SAFE_INTEGER;
    return [parent, ...categories.filter(child => child.parentId === parent.id).sort((a, b) => index(a) - index(b) || a.name.localeCompare(b.name, "tr"))];
  })
    .map(item => ({ ...item, label: categoryLabel(categories, item.id) }));
}
export function resolveCategory(categories: Category[], value: string) {
  return categories.find(item => item.id === value)
    ?? categories.find(item => categoryLabel(categories, item.id) === value)
    ?? categories.find(item => item.name === value)
    ?? categories.find(item => item.id === legacyCategoryIds[value]);
}
