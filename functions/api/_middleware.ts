import type { Env } from "../_lib/types";
import { isAuthenticated } from "../_lib/auth";

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  if (url.pathname === "/api/login") {
    return context.next();
  }
  const ok = await isAuthenticated(context.request, context.env.APP_PASSWORD);
  if (!ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return context.next();
};
