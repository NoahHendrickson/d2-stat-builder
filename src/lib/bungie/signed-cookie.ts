/**
 * HMAC-signed cookie payloads. The server keys its own database rows on the identity
 * in the `d2_user` cookie, so that value must be tamper-evident: httpOnly stops page
 * scripts, but nothing stops a hand-crafted request from sending any cookie it likes.
 *
 * Format: `<base64url(JSON)>.<base64url(HMAC-SHA256)>`. Pure Web Crypto so it runs in
 * Node route handlers and in vitest without extra deps.
 */

const enc = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** Serialize + sign `value` with `secret`. */
export async function encodeSigned(value: unknown, secret: string): Promise<string> {
  const payload = enc.encode(JSON.stringify(value));
  const key = await hmacKey(secret, "sign");
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return `${toBase64Url(payload)}.${toBase64Url(sig)}`;
}

/**
 * Verify + parse a value produced by `encodeSigned`. Returns null for anything that
 * isn't a well-formed, correctly signed payload (including legacy unsigned cookies).
 */
export async function decodeSigned<T = unknown>(
  raw: string | undefined,
  secret: string,
): Promise<T | null> {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = fromBase64Url(raw.slice(0, dot));
  const sig = fromBase64Url(raw.slice(dot + 1));
  if (!payload || !sig) return null;
  const key = await hmacKey(secret, "verify");
  // subtle.verify is constant-time; a plain string compare would leak timing.
  const ok = await crypto.subtle.verify("HMAC", key, sig, payload);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as T;
  } catch {
    return null;
  }
}
