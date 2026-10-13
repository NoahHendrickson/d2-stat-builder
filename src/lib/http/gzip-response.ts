import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

/**
 * Gzip a route's response body before it leaves the function, when the client accepts
 * gzip. Vercel bills Fast Origin Transfer on what the function sends the CDN, and the
 * Destiny profile is several MB of JSON; browsers decode it transparently, so the
 * client code doesn't change. Level 6 is zlib's default: a multi-MB profile takes tens
 * of milliseconds, small next to Bungie's own response time.
 */
export async function gzipResponse(request: Request, response: Response): Promise<Response> {
  const accepts = request.headers.get("accept-encoding") ?? "";
  if (!/\bgzip\b/i.test(accepts) || !response.body || response.headers.has("content-encoding")) {
    return response;
  }
  const body = await gzipAsync(new Uint8Array(await response.arrayBuffer()));
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.set("content-length", String(body.byteLength));
  headers.append("vary", "Accept-Encoding");
  return new Response(new Uint8Array(body), { status: response.status, headers });
}
