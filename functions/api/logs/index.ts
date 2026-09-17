import type { Env } from "../../_lib/types";

interface LogRow {
  id: number;
  taskId: number;
  startAt: string;
  endAt: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return Response.json({ error: "invalid_range" }, { status: 400 });
  }
  const { results } = await context.env.DB.prepare(
    `SELECT id, task_id as taskId, start_at as startAt, end_at as endAt
     FROM time_logs
     WHERE start_at >= ? AND start_at < ?
     ORDER BY start_at ASC`
  )
    .bind(from, to)
    .all<LogRow>();
  return Response.json({ logs: results ?? [] });
};
