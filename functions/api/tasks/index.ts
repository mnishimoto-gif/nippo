import type { Env } from "../../_lib/types";

interface TaskRow {
  id: number;
  project: string;
  category: string;
  name: string;
  hidden: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { results } = await context.env.DB.prepare(
    "SELECT id, project, category, name, hidden FROM tasks ORDER BY created_at ASC"
  ).all<TaskRow>();
  const tasks = (results ?? []).map((r) => ({
    id: r.id,
    project: r.project,
    category: r.category,
    name: r.name,
    hidden: !!r.hidden,
  }));
  return Response.json({ tasks });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as
    | { project?: string; category?: string; name?: string }
    | null;
  const project = body?.project?.trim();
  const name = body?.name?.trim();
  const category = body?.category;
  if (!project || !name || (category !== "作業" && category !== "MTG")) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const created = await context.env.DB.prepare(
    `INSERT INTO tasks (project, category, name, hidden, created_at)
     VALUES (?, ?, ?, 0, ?)
     RETURNING id, project, category, name, hidden`
  )
    .bind(project, category, name, now)
    .first<TaskRow>();
  return Response.json(
    {
      id: created?.id,
      project,
      category,
      name,
      hidden: false,
    },
    { status: 201 }
  );
};
