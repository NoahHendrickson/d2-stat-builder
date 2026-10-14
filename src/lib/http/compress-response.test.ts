import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { compressResponse, pickEncoding } from "./compress-response";

const req = (acceptEncoding?: string) =>
  new Request("https://d2conflux.com/api/bungie/profile", {
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

const body = { items: Array.from({ length: 200 }, (_, i) => ({ itemHash: i })) };

describe("compressResponse", () => {
  it("sends Brotli when the browser accepts it", async () => {
    const res = compressResponse(req("gzip, deflate, br, zstd"), json(body, 401));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.has("content-length")).toBe(false);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(brotliDecompressSync(bytes).toString())).toEqual(body);
  });

  it("falls back to gzip", async () => {
    const res = compressResponse(req("gzip, deflate"), json(body));
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(body);
  });

  it("passes the response through when neither is accepted", () => {
    const original = json({ ok: true });
    expect(compressResponse(req(), original)).toBe(original);
    expect(compressResponse(req("deflate"), original)).toBe(original);
    expect(compressResponse(req("br;q=0, gzip;q=0, identity"), original)).toBe(original);
  });

  it("passes a bodiless or already-encoded response through", () => {
    const notModified = new Response(null, { status: 304 });
    expect(compressResponse(req("br"), notModified)).toBe(notModified);
    const encoded = new Response("x", { headers: { "content-encoding": "gzip" } });
    expect(compressResponse(req("br"), encoded)).toBe(encoded);
  });
});

describe("pickEncoding", () => {
  it("prefers Brotli, then gzip, honouring quality values", () => {
    expect(pickEncoding("gzip, deflate, br")).toBe("br");
    expect(pickEncoding("BR;q=0.5, gzip")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding("br;q=0, gzip")).toBe("gzip");
    expect(pickEncoding("gzip;q=0, br;q=0.0")).toBeUndefined();
    expect(pickEncoding("identity, gzip;q=0")).toBeUndefined();
  });

  it("lets the wildcard cover what isn't named", () => {
    expect(pickEncoding("*")).toBe("br");
    expect(pickEncoding("br;q=0, *")).toBe("gzip");
    expect(pickEncoding("*;q=0")).toBeUndefined();
    expect(pickEncoding(null)).toBeUndefined();
  });
});
