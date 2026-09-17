import type { Env } from "../../_lib/types";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const now = new Date().toISOString();
  const active = await context.env.DB.prepare("SELECT id FROM time_logs WHERE end_at IS NULL").first<{
    id: number;
  }>();
  if (active) {
    await context.env.DB.prepare("UPDATE time_logs SET end_at = ? WHERE id = ?").bind(now, active.id).run();
  }
  return Response.json({ ok: true });
};
