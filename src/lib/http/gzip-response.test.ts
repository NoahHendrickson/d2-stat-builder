import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gzipResponse } from "./gzip-response";

const req = (acceptEncoding?: string) =>
  new Request("https://d2conflux.com/api/bungie/profile", {
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

describe("gzipResponse", () => {
  it("gzips the body when the client accepts gzip", async () => {
    const body = { items: Array.from({ length: 200 }, (_, i) => ({ itemHash: i })) };
    const res = await gzipResponse(req("gzip, deflate, br, zstd"), json(body, 401));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(bytes.byteLength);
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(body);
  });

  it("passes the response through when gzip isn't accepted", async () => {
    const original = json({ ok: true });
    expect(await gzipResponse(req(), original)).toBe(original);
    expect(await gzipResponse(req("br"), original)).toBe(original);
  });
});
