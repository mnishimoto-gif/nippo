import type { Env } from "../../_lib/types";

interface LogRow {
  id: number;
  taskId: number;
  startAt: string;
  endAt: string | null;
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const existing = await context.env.DB.prepare(
    "SELECT id, task_id as taskId, start_at as startAt, end_at as endAt FROM time_logs WHERE id = ?"
  )
    .bind(id)
    .first<LogRow>();
  if (!existing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const body = (await context.request.json().catch(() => null)) as
    | { taskId?: number; startAt?: string; endAt?: string | null }
    | null;

  const taskId = body?.taskId ?? existing.taskId;
  const startAt = body?.startAt ?? existing.startAt;
  const endAt = body && "endAt" in body ? body.endAt ?? null : existing.endAt;

  if (endAt && new Date(startAt).getTime() >= new Date(endAt).getTime()) {
    return Response.json({ error: "invalid_range" }, { status: 400 });
  }

  await context.env.DB.prepare("UPDATE time_logs SET task_id = ?, start_at = ?, end_at = ? WHERE id = ?")
    .bind(taskId, startAt, endAt, id)
    .run();

  return Response.json({ id, taskId, startAt, endAt });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const id = Number(context.params.id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const existing = await context.env.DB.prepare("SELECT id FROM time_logs WHERE id = ?").bind(id).first();
  if (!existing) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await context.env.DB.prepare("DELETE FROM time_logs WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
};
