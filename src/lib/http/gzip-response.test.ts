import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { acceptsGzip, gzipResponse } from "./gzip-response";

const req = (acceptEncoding?: string) =>
  new Request("https://d2conflux.com/api/bungie/profile", {
    headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {},
  });

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

describe("gzipResponse", () => {
  it("gzips the body when the client accepts gzip", async () => {
    const body = { items: Array.from({ length: 200 }, (_, i) => ({ itemHash: i })) };
    const res = gzipResponse(req("gzip, deflate, br, zstd"), json(body, 401));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("vary")).toContain("Accept-Encoding");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.has("content-length")).toBe(false);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(body);
  });

  it("passes the response through when gzip isn't accepted", () => {
    const original = json({ ok: true });
    expect(gzipResponse(req(), original)).toBe(original);
    expect(gzipResponse(req("br"), original)).toBe(original);
    expect(gzipResponse(req("gzip;q=0, identity;q=1"), original)).toBe(original);
  });

  it("passes a bodiless response through", () => {
    const notModified = new Response(null, { status: 304 });
    expect(gzipResponse(req("gzip"), notModified)).toBe(notModified);
  });
});

describe("acceptsGzip", () => {
  it("reads gzip's own quality", () => {
    expect(acceptsGzip("gzip")).toBe(true);
    expect(acceptsGzip("GZIP;q=0.5")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("gzip;q=0.0")).toBe(false);
    expect(acceptsGzip("identity, gzip;q=0")).toBe(false);
    expect(acceptsGzip("*, gzip;q=0")).toBe(false);
  });

  it("falls back to the wildcard only when gzip isn't named", () => {
    expect(acceptsGzip("*")).toBe(true);
    expect(acceptsGzip("br, *;q=0.1")).toBe(true);
    expect(acceptsGzip("*;q=0")).toBe(false);
    expect(acceptsGzip("br")).toBe(false);
    expect(acceptsGzip(null)).toBe(false);
  });
});
