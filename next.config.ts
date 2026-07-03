import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Static CSP (no nonces — those require the proxy.ts convention and force
 * dynamic rendering). Next injects inline bootstrap scripts, so script-src
 * keeps 'unsafe-inline'; the value here is the other directives: framing,
 * object/base/form lockdown, and restricting fetch targets to bungie.net.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Icons render via next/image (same-origin proxy) but allow bungie.net directly too.
  "img-src 'self' https://www.bungie.net data: blob:",
  "font-src 'self'",
  // Client fetches the manifest straight from bungie.net; dev needs the HMR websocket.
  `connect-src 'self' https://www.bungie.net${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.bungie.net", pathname: "/common/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
