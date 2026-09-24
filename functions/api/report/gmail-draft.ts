import type { Env } from "../../_lib/types";
import { createDraft } from "../../_lib/gmail";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  const { to, subject, body } = (payload ?? {}) as Record<string, unknown>;
  if (
    typeof to !== "string" || !to.trim() ||
    typeof subject !== "string" || !subject.trim() ||
    typeof body !== "string" || !body.trim()
  ) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const { draftId } = await createDraft(context.env, { to, subject, body });
    return Response.json(
      { ok: true, draftId, url: "https://mail.google.com/mail/u/0/#drafts" },
      { status: 201 }
    );
  } catch {
    return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
  }
};
