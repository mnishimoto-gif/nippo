import type { Env } from "../../_lib/types";

interface ImportItem {
  project?: string;
  category?: string;
  name?: string;
  frequency?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as { items?: ImportItem[] } | null;
  const items = body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const existing = await context.env.DB.prepare("SELECT project, category, name FROM tasks").all<{
    project: string;
    category: string;
    name: string;
  }>();
  const existingKeys = new Set((existing.results ?? []).map((t) => `${t.project}\u0000${t.category}\u0000${t.name}`));

  const now = new Date().toISOString();
  const statements = [];
  let skipped = 0;
  for (const item of items) {
    const project = item.project?.trim();
    const name = item.name?.trim();
    const category = item.category === "MTG" ? "MTG" : "作業";
    const frequency = item.frequency?.trim() || null;
    if (!project || !name) {
      skipped++;
      continue;
    }
    const key = `${project}\u0000${category}\u0000${name}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    existingKeys.add(key);
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO tasks (project, category, name, hidden, frequency, created_at) VALUES (?, ?, ?, 0, ?, ?)`
      ).bind(project, category, name, frequency, now)
    );
  }

  if (statements.length > 0) {
    await context.env.DB.batch(statements);
  }
  return Response.json({ inserted: statements.length, skipped });
};
