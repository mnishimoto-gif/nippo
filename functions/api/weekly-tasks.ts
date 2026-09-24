import type { Env } from "../_lib/types";

interface WeeklyTasksRow {
  content: string;
  updatedAt: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const row = await context.env.DB.prepare(
    "SELECT content, updated_at as updatedAt FROM weekly_tasks WHERE id = 1"
  ).first<WeeklyTasksRow>();
  return Response.json({ content: row?.content ?? "", updatedAt: row?.updatedAt ?? null });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as { content?: string } | null;
  if (typeof body?.content !== "string") {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const now = new Date().toISOString();
  await context.env.DB.prepare("UPDATE weekly_tasks SET content = ?, updated_at = ? WHERE id = 1")
    .bind(body.content, now)
    .run();
  return Response.json({ content: body.content, updatedAt: now });
};
