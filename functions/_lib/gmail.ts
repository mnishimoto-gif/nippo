import type { Env } from "./types";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// メールヘッダーは基本ASCIIしか使えないため、日本語などを含む場合はRFC 2047の
// エンコード済みワード（=?UTF-8?B?...?=）に変換する。ASCIIのみならそのまま返す。
function encodeHeaderWord(text: string): string {
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${toBase64(new TextEncoder().encode(text))}?=`;
}

// "表示名 <email>" が複数カンマ区切りで並ぶ宛先文字列を、表示名部分だけ
// エンコードした形式に変換する（emailアドレス自体はASCIIのまま保つ）。
function encodeAddressList(addressList: string): string {
  return addressList
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const m = trimmed.match(/^(.*)<(.+)>$/);
      if (!m) return encodeHeaderWord(trimmed);
      const name = m[1].trim();
      const email = m[2].trim();
      return name ? `${encodeHeaderWord(name)} <${email}>` : `<${email}>`;
    })
    .join(", ");
}

export function buildRawMessage(to: string, subject: string, body: string): string {
  const message =
    `To: ${encodeAddressList(to)}\r\n` +
    `Subject: ${encodeHeaderWord(subject)}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n` +
    body;
  return toBase64Url(new TextEncoder().encode(message));
}

async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("gmail_token_refresh_failed");
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("gmail_token_refresh_failed");
  return json.access_token;
}

export async function createDraft(
  env: Env,
  fields: { to: string; subject: string; body: string }
): Promise<{ draftId: string }> {
  const accessToken = await getAccessToken(env);
  const raw = buildRawMessage(fields.to, fields.subject, fields.body);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) throw new Error("gmail_draft_create_failed");
  const json = (await res.json()) as { id: string };
  return { draftId: json.id };
}
