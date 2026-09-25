import type { Env } from "../../_lib/types";

interface TaskRow {
  id: number;
  project: string;
  category: string;
  name: string;
  hidden: number;
  frequency: string | null;
  last_used_at: string | null;
  use_count_30d: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await context.env.DB.prepare(
    `SELECT
       t.id, t.project, t.category, t.name, t.hidden, t.frequency,
       (SELECT MAX(start_at) FROM time_logs WHERE task_id = t.id) as last_used_at,
       (SELECT COUNT(*) FROM time_logs WHERE task_id = t.id AND start_at >= ?) as use_count_30d
     FROM tasks t
     ORDER BY t.created_at ASC`
  )
    .bind(cutoff)
    .all<TaskRow>();
  const tasks = (results ?? []).map((r) => ({
    id: r.id,
    project: r.project,
    category: r.category,
    name: r.name,
    hidden: !!r.hidden,
    frequency: r.frequency,
    lastUsedAt: r.last_used_at,
    useCount30d: r.use_count_30d,
  }));
  return Response.json({ tasks });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as
    | { project?: string; category?: string; name?: string; frequency?: string }
    | null;
  const project = body?.project?.trim();
  const name = body?.name?.trim();
  const category = body?.category;
  const frequency = body?.frequency?.trim() || null;
  if (!project || !name || (category !== "作業" && category !== "MTG")) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const created = await context.env.DB.prepare(
    `INSERT INTO tasks (project, category, name, hidden, frequency, created_at)
     VALUES (?, ?, ?, 0, ?, ?)
     RETURNING id, project, category, name, hidden, frequency`
  )
    .bind(project, category, name, frequency, now)
    .first<TaskRow>();
  return Response.json(
    {
      id: created?.id,
      project,
      category,
      name,
      hidden: false,
      frequency,
      lastUsedAt: null,
      useCount30d: 0,
    },
    { status: 201 }
  );
};
