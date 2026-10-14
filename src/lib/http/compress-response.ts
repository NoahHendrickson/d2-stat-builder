import { Readable } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

export type Encoding = "br" | "gzip";

/**
 * Brotli quality 5 and gzip level 6 take about the same CPU on a profile-sized JSON
 * body; Brotli's output is the smaller of the two, which is why the CDN would have
 * picked it for an uncompressed response.
 */
const BROTLI_QUALITY = 5;
const GZIP_LEVEL = 6;

/**
 * Compress a route's response body before it leaves the function, in the encoding the
 * client prefers: Brotli when accepted (what Vercel's CDN serves for a plain JSON
 * response, so the browser's download is no larger than before), else gzip. Vercel
 * bills Fast Origin Transfer on what the function sends the CDN, and the Destiny
 * profile is several MB of JSON; browsers decode either encoding transparently. The
 * body is streamed through the compressor, so the function never holds a second
 * copy; without a known final size there is no Content-Length.
 */
export function compressResponse(request: Request, response: Response): Response {
  const encoding = pickEncoding(request.headers.get("accept-encoding"));
  if (!encoding || !response.body || response.headers.has("content-encoding")) {
    return response;
  }
  const compressor =
    encoding === "br"
      ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY } })
      : createGzip({ level: GZIP_LEVEL });
  const headers = new Headers(response.headers);
  headers.set("content-encoding", encoding);
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  const body = Readable.toWeb(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(compressor),
  ) as ReadableStream<Uint8Array>;
  return new Response(body, { status: response.status, headers });
}

/**
 * The encoding an Accept-Encoding header asks for: Brotli over gzip when both are
 * allowed with a non-zero quality. A coding named with `q=0` is refused; `*` covers
 * whichever is not named.
 */
export function pickEncoding(acceptEncoding: string | null): Encoding | undefined {
  if (!acceptEncoding) return undefined;
  const named = new Map<string, number>();
  for (const entry of acceptEncoding.split(",")) {
    const [coding, ...params] = entry.trim().split(";");
    const name = coding.trim().toLowerCase();
    if (!name) continue;
    const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));
    const quality = q ? Number(q.slice(2)) : 1;
    named.set(name, Number.isFinite(quality) ? quality : 0);
  }
  const allowed = (encoding: Encoding) => (named.get(encoding) ?? named.get("*") ?? 0) > 0;
  if (allowed("br")) return "br";
  if (allowed("gzip")) return "gzip";
  return undefined;
}
