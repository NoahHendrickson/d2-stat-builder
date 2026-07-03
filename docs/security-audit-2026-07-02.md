# Security Audit — 2026-07-02

Audit of stat-builder (Next.js 16 App Router + Bungie OAuth). Scope: auth/token
handling, server attack surface and configuration, client-side risks, and supply
chain. Method: three parallel code sweeps, with every non-trivial finding
hand-verified against the source before rating.

**Overall posture: strong.** No exploitable vulnerabilities were found. The gaps
below are defense-in-depth improvements; all except the accepted risks were fixed
in this audit's accompanying change.

## Findings

### M1 — No security headers / CSP (Medium) — FIXED
There were no security headers anywhere (no `headers()` in next.config, no
middleware/proxy). XSS defense relied solely on React escaping; nothing prevented
framing, MIME sniffing, or exfiltration to arbitrary origins.

**Fix:** static headers in `next.config.ts` on all routes:
Content-Security-Policy, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
The CSP restricts `connect-src` to self + `www.bungie.net`, locks
`object-src`/`base-uri`/`form-action`/`frame-ancestors`, and allows workers
(`'self' blob:`) for the optimizer. `script-src` keeps `'unsafe-inline'` because
Next injects inline bootstrap scripts and a nonce-based CSP requires the
`proxy.ts` convention plus dynamic rendering on every page — not worth the
trade-off for this app. `'unsafe-eval'` and HMR websockets are dev-only, gated
on `NODE_ENV`.

### M2 — Server trusted a client-writable cookie for identity (Medium) — FIXED
`d2_user` was set with `httpOnly: false` and unsigned, yet server routes
(`/api/bungie/profile`, `/api/bungie/equip`) read `destinyMembershipId` /
`destinyMembershipType` from it via `readUser()`. Client JS could rewrite those
values. Practical impact was contained — every Bungie call uses the user's own
OAuth token, so Bungie rejects cross-account actions — but server-side identity
must not come from a client-writable value. Nothing on the client actually read
the cookie (identity comes from `/api/auth/session`), so the readable flag
bought nothing.

**Fix:** `d2_user` is now httpOnly like the token cookies
(`src/lib/bungie/session.ts`). No client changes were needed.

### L1 — Logout CSRF via GET (Low) — FIXED
`GET /api/auth/logout` cleared the session. SameSite=Lax cookies attach on
cross-site top-level GET navigations, so any page could sign the user out with a
link or redirect. (The equip POST is *not* CSRF-vulnerable: Lax cookies don't
attach on cross-site POSTs, and it requires a JSON body.)

**Fix:** the route is POST-only (GET now returns 405); the sign-out button
posts via `fetch` (`src/components/auth/sign-in-card.tsx`).

### L2 — `characterId` ownership not validated in equip route (Low) — ACCEPTED
`/api/bungie/equip` forwards a body-supplied `characterId` to Bungie without
checking it belongs to the signed-in user. Not exploitable cross-account —
Bungie enforces ownership against the OAuth token — and local validation would
cost an extra profile fetch per equip. Accepted; revisit if the route ever uses
credentials that aren't the user's own.

### L3 — No app-level rate limiting (Low) — ACCEPTED
Auth and equip routes have no rate limit of their own. Bungie rate-limits per
token, item actions are spaced 150 ms apart, and the app is hobby-scale.
Accepted; add middleware-level limiting if the app is ever hosted for others.

### I1 — Full error object logged in OAuth callback (Info) — FIXED
`console.error("OAuth callback failed", err)` could log Bungie response bodies.
Now logs the message only (`src/app/api/auth/callback/route.ts`).

## Checked and clean

- **OAuth flow:** state param is a random UUID in an httpOnly/secure/lax cookie,
  single-use (deleted before validation), 10-min expiry. Token exchange is
  server-to-server; tokens never appear in URLs or redirects.
- **Token storage:** access + refresh tokens live only in httpOnly/secure/lax
  cookies; `/api/auth/session` returns `{authenticated, user}` only. Refresh
  rotates tokens and clears the session on failure/expiry.
- **Secrets:** `BUNGIE_CLIENT_SECRET` is server-only; `NEXT_PUBLIC_BUNGIE_API_KEY`
  is public by Bungie's design. `.env*` is gitignored; only `.env.example` is
  committed; no secrets in source.
- **XSS:** no `dangerouslySetInnerHTML` / `innerHTML` / `eval` anywhere; all
  Bungie manifest strings render as JSX text.
- **Client storage:** localStorage/IndexedDB hold only UI state (filters,
  selections, manifest cache); all parses are guarded with schema checks.
- **DIM handoff:** loadout URL built with `encodeURIComponent(JSON.stringify(...))`,
  opened with `noopener,noreferrer`, hardcoded destination.
- **Open redirects:** none — all redirects use the `APP_URL` constant.
- **Worker:** same-origin module worker, internal messages only, stale-result
  sequence guard.
- **Supply chain:** 14 production deps, npm lockfile, no git deps, no install
  scripts. `npm audit` (2026-07-02): two moderate advisories, both the same
  transitive `postcss < 8.5.10` pin inside `next@16.2.9` itself — no
  non-breaking fix available; not directly exploitable here (build-time
  stringifier). Re-check on the next Next.js upgrade.
- **Leftover debug surface:** none — route inventory is exactly
  `/api/auth/{login,callback,logout,session}` + `/api/bungie/{profile,equip}`.

## Verification performed

- `npm run build` passes (types clean); `npm run lint` shows only pre-existing
  errors in untouched files.
- Dev server: all four headers present on responses; page renders with no CSP
  violations; blob workers spawn; `fetch` to an arbitrary origin is blocked by
  CSP while `www.bungie.net` succeeds.
- `GET /api/auth/logout` → 405; `POST` → 200.
