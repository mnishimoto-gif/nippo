import type { Env } from "../../_lib/types";

interface LogRow {
  id: number;
  taskId: number;
  startAt: string;
  endAt: string | null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as { taskId?: number } | null;
  const taskId = body?.taskId;
  if (!Number.isInteger(taskId)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const task = await context.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(taskId).first();
  if (!task) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const now = new Date().toISOString();
  const active = await context.env.DB.prepare("SELECT id FROM time_logs WHERE end_at IS NULL").first<{
    id: number;
  }>();
  if (active) {
    await context.env.DB.prepare("UPDATE time_logs SET end_at = ? WHERE id = ?").bind(now, active.id).run();
  }
  const created = await context.env.DB.prepare(
    `INSERT INTO time_logs (task_id, start_at, end_at, created_at)
     VALUES (?, ?, NULL, ?)
     RETURNING id, task_id as taskId, start_at as startAt, end_at as endAt`
  )
    .bind(taskId, now, now)
    .first<LogRow>();
  return Response.json(created, { status: 201 });
};
