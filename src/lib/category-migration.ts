import "server-only";
import type { Client } from "@libsql/client";
import { categoryDefinitions, legacyCategoryIds } from "./types";

export async function applyCategoryTaxonomy(db: Client) {
  await db.execute("CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY)");
  const tx = await db.transaction("write");
  try {
    if ((await tx.execute("SELECT id FROM app_migrations WHERE id = 'category-taxonomy-v2'")).rows.length) { await tx.commit(); return; }
    const redirects = new Map<string, string>();
    const legacyOverrides = new Map<string, string>();
    async function merge(from: string, to: string) {
      if (from === to) return;
      const children = await tx.execute({ sql: "SELECT id, name FROM categories WHERE parent_id = ?", args: [from] });
      for (const child of children.rows) {
        const duplicate = await tx.execute({ sql: "SELECT id FROM categories WHERE parent_id = ? AND name = ? COLLATE NOCASE", args: [to, child.name] });
        if (duplicate.rows.length) await merge(String(child.id), String(duplicate.rows[0].id));
        else await tx.execute({ sql: "UPDATE categories SET parent_id = ? WHERE id = ?", args: [to, child.id] });
      }
      await tx.execute({ sql: "UPDATE expenses SET category = ? WHERE category = ?", args: [to, from] });
      await tx.execute({ sql: "DELETE FROM categories WHERE id = ?", args: [from] });
      redirects.set(from, to);
    }
    async function ensure(id: string, name: string, parentId: string | null): Promise<string> {
      const named = await tx.execute({ sql: "SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id IS ?", args: [name, parentId] });
      const existing = await tx.execute({ sql: "SELECT id FROM categories WHERE id = ?", args: [id] });
      if (named.rows.length) {
        const target = String(named.rows[0].id);
        if (existing.rows.length && target !== id) await merge(id, target);
        redirects.set(id, target);
        return target;
      }
      if (existing.rows.length) await tx.execute({ sql: "UPDATE categories SET name = ?, parent_id = ? WHERE id = ?", args: [name, parentId, id] });
      else await tx.execute({ sql: "INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)", args: [id, name, parentId] });
      return id;
    }
    const other = await ensure("default-9", "Diğer", null);
    const education = await tx.execute("SELECT id FROM categories WHERE id = 'default-8' AND name = 'Eğitim'");
    if (education.rows.length) {
      // Historical education expenses must not become entertainment expenses.
      await merge("default-8", other);
      legacyOverrides.set("default-8", other);
    }
    for (const definition of categoryDefinitions) {
      const root = await ensure(definition.id, definition.name, null);
      for (const [index, name] of definition.children.entries()) await ensure(`${definition.id}-sub-${index}`, name, root);
    }
    const analyses = await tx.execute("SELECT statement_id, result FROM statement_analyses WHERE result IS NOT NULL");
    const redirect = (value: string) => {
      let id = legacyCategoryIds[value] ?? value;
      id = legacyOverrides.get(id) ?? id;
      const seen = new Set<string>();
      while (redirects.has(id) && !seen.has(id)) { seen.add(id); id = redirects.get(id)!; }
      return id;
    };
    for (const row of analyses.rows) {
      let result;
      try { result = JSON.parse(String(row.result)); } catch { continue; }
      if (!Array.isArray(result?.rows)) continue;
      let changed = false;
      for (const item of result.rows) {
        if (typeof item?.category !== "string") continue;
        const id = redirect(item.category);
        if (id !== item.category) { item.category = id; changed = true; }
      }
      if (changed) await tx.execute({ sql: "UPDATE statement_analyses SET result = ? WHERE statement_id = ?", args: [JSON.stringify(result), row.statement_id] });
    }
    // Also migrate labels from the earliest version before it had category IDs.
    for (const [label, id] of Object.entries(legacyCategoryIds)) await tx.execute({ sql: "UPDATE expenses SET category = ? WHERE category = ?", args: [redirect(id), label] });
    await tx.execute("INSERT INTO app_migrations VALUES ('category-taxonomy-v2')");
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
