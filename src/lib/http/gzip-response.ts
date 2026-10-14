/**
 * Gzip a route's response body before it leaves the function, when the client accepts
 * gzip. Vercel bills Fast Origin Transfer on what the function sends the CDN, and the
 * Destiny profile is several MB of JSON; browsers decode it transparently, so the
 * client code doesn't change. The body is streamed through the compressor, so the
 * function never holds a second copy; without a known final size there is no
 * Content-Length.
 */
export function gzipResponse(request: Request, response: Response): Response {
  if (
    !acceptsGzip(request.headers.get("accept-encoding")) ||
    !response.body ||
    response.headers.has("content-encoding")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    headers,
  });
}

/**
 * Whether an Accept-Encoding header allows gzip: named with a non-zero quality, or
 * covered by `*` when gzip isn't named. `gzip;q=0` is an explicit refusal.
 */
export function acceptsGzip(acceptEncoding: string | null): boolean {
  if (!acceptEncoding) return false;
  let wildcard: number | undefined;
  for (const entry of acceptEncoding.split(",")) {
    const [coding, ...params] = entry.trim().split(";");
    const name = coding.trim().toLowerCase();
    if (name !== "gzip" && name !== "*") continue;
    const q = params
      .map((p) => p.trim().toLowerCase())
      .find((p) => p.startsWith("q="));
    const quality = q ? Number(q.slice(2)) : 1;
    const accepted = Number.isFinite(quality) && quality > 0;
    if (name === "gzip") return accepted;
    wildcard = quality;
  }
  return wildcard !== undefined && wildcard > 0;
}
