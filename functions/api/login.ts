import type { Env } from "../_lib/types";
import { createAuthCookie } from "../_lib/auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json().catch(() => null)) as { password?: string } | null;
  const password = body?.password;
  if (typeof password !== "string" || password.length === 0 || password !== context.env.APP_PASSWORD) {
    return Response.json({ ok: false, error: "invalid_password" }, { status: 401 });
  }
  const cookie = await createAuthCookie(context.env.APP_PASSWORD);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
  });
};
