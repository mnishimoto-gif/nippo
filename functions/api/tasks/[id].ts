import type { Env } from "../../_lib/types";

interface TaskRow {
  id: number;
  project: string;
  category: string;
  name: string;
  hidden: number;
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const body = (await context.request.json().catch(() => null)) as { hidden?: boolean } | null;
  if (!body || typeof body.hidden !== "boolean") {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const existing = await context.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(id).first();
  if (!existing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await context.env.DB.prepare("UPDATE tasks SET hidden = ? WHERE id = ?")
    .bind(body.hidden ? 1 : 0, id)
    .run();
  const updated = await context.env.DB.prepare(
    "SELECT id, project, category, name, hidden FROM tasks WHERE id = ?"
  )
    .bind(id)
    .first<TaskRow>();
  return Response.json({
    id: updated!.id,
    project: updated!.project,
    category: updated!.category,
    name: updated!.name,
    hidden: !!updated!.hidden,
  });
};
