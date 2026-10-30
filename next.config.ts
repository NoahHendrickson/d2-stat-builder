import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Static CSP (no nonces — those require the proxy.ts convention and force
 * dynamic rendering). Next injects inline bootstrap scripts, so script-src
 * keeps 'unsafe-inline'; the value here is the other directives: framing,
 * object/base/form lockdown, and restricting fetch targets to bungie.net.
 *
 * Startup depends on 'unsafe-inline' too: the `beforeInteractive` bootstrap in
 * layout.tsx (src/lib/early-fetch.ts) starts the session + profile requests before
 * the bundle loads. Tightening script-src to a nonce would silently block it — the
 * app still works, just slower — so move that script to a nonced one first.
 */
const cspDirectives = [
  "default-src 'self'",
  // Dev also loads Figma's html-to-design capture script (Send to Figma).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://mcp.figma.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Icons render via next/image (same-origin proxy) but allow bungie.net directly too.
  "img-src 'self' https://www.bungie.net data: blob:",
  "font-src 'self'",
  // Client fetches the manifest straight from bungie.net, weapon perk insights
  // from Clarity's GitHub Pages feed, and perk popularity from our own GitHub
  // Pages data repo (kept off Vercel); dev needs the HMR websocket.
  `connect-src 'self' https://www.bungie.net https://database-clarity.github.io https://noahhendrickson.github.io${isDev ? " ws: wss: https://mcp.figma.com" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The What's new video.
  "frame-src https://www.youtube-nocookie.com",
];
const csp = [...cspDirectives, "frame-ancestors 'none'"].join("; ");

/**
 * /components/embed is the component showcase, framed on the portfolio's D2 Conflux
 * page (noahjh.com/work/stat-builder). It holds no account data or actions, so the
 * portfolio may frame it; every other route still refuses to be framed. Dev also
 * allows a local portfolio server.
 */
const EMBED_PATH = "/components/embed";
const embedCsp = [
  ...cspDirectives,
  `frame-ancestors https://noahjh.com https://*.noahjh.com${isDev ? " http://localhost:*" : ""}`,
].join("; ");
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Cache Components makes the router keep recently visited routes mounted (React
  // <Activity> in "hidden" mode) instead of unmounting them, so switching between the
  // optimizer and the armor table is a show/hide, not a rebuild of the whole view.
  cacheComponents: true,
  // The default bottom-left badge sits on the sidebar's collapse toggle.
  devIndicators: { position: "bottom-right" },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.bungie.net", pathname: "/common/**" },
      { protocol: "https", hostname: "www.bungie.net", pathname: "/img/**" },
    ],
  },
  // Share links used to point at the optimizer while loadouts lived in its sidebar;
  // forward them to the loadouts page (the query string is carried over).
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "query", key: "import" }],
        destination: "/loadouts",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      // Everything but the embed: X-Frame-Options can only deny or allow same-origin,
      // so the embed has to be kept out of this rule rather than overridden after it.
      {
        source: "/:path((?!components/embed$).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          ...securityHeaders,
        ],
      },
      {
        source: EMBED_PATH,
        headers: [{ key: "Content-Security-Policy", value: embedCsp }, ...securityHeaders],
      },
      // API answers depend on the session cookies: keep them out of shared caches.
      // The favicon proxy is public and cacheable; the apply stream sets its own.
      {
        source: "/api/:path((?!favicon|bungie/apply-loadout).*)",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      // The weapon catalog snapshot changes only when it is regenerated and
      // committed; let repeat visits reuse it for an hour instead of revalidating.
      // Not in dev, where a regenerated snapshot should show on the next reload.
      ...(isDev
        ? []
        : [
            {
              source: "/data/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=3600, stale-while-revalidate=86400",
                },
              ],
            },
          ]),
    ];
  },
};

export default nextConfig;
