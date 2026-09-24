import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../functions/_lib/gmail";

function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// RFC 2047の "=?UTF-8?B?<base64>?=" 形式のエンコード済みワードを元の文字列に戻す
function decodeEncodedWord(headerValue: string): string {
  return headerValue.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  });
}

describe("buildRawMessage", () => {
  it("宛先・件名・本文を含むMIMEメッセージ（base64url）を生成する", () => {
    const raw = buildRawMessage(
      "西本 <m.nishimoto@tcdigital.jp>",
      "【日報】0917_西本",
      "■本日の作業内容\n・タスクA（1.00h）"
    );
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");

    const decoded = decodeBase64Url(raw);
    // ヘッダーはASCIIのみで構成されている（日本語部分はエンコード済みワード化されている）
    const [headerPart] = decoded.split("\r\n\r\n");
    expect(/^[\x00-\x7F]*$/.test(headerPart)).toBe(true);

    const toLine = headerPart.split("\r\n").find((l) => l.startsWith("To: "));
    const subjectLine = headerPart.split("\r\n").find((l) => l.startsWith("Subject: "));
    expect(decodeEncodedWord(toLine!)).toBe("To: 西本 <m.nishimoto@tcdigital.jp>");
    expect(decodeEncodedWord(subjectLine!)).toBe("Subject: 【日報】0917_西本");

    expect(decoded).toContain("Content-Type: text/plain; charset=\"UTF-8\"");
    expect(decoded).toContain("■本日の作業内容\n・タスクA（1.00h）");
  });

  it("複数宛先（表示名＋メールアドレス）でも表示名だけがエンコードされ、メールアドレスはASCIIのまま保たれる", () => {
    const to = "管理部用グループ <tdmng@tcdigital.jp>, 東園直樹 <n.higashizono@tcdigital.jp>";
    const raw = buildRawMessage(to, "件名", "本文");
    const decoded = decodeBase64Url(raw);
    const toLine = decoded.split("\r\n").find((l) => l.startsWith("To: "))!;
    expect(toLine).toContain("<tdmng@tcdigital.jp>");
    expect(toLine).toContain("<n.higashizono@tcdigital.jp>");
    expect(decodeEncodedWord(toLine)).toBe(`To: ${to}`);
  });

  it("本文中の改行を保持する", () => {
    const raw = buildRawMessage("a <a@example.com>", "件名", "1行目\n2行目\n3行目");
    const decoded = decodeBase64Url(raw);
    expect(decoded).toContain("1行目\n2行目\n3行目");
  });
});
