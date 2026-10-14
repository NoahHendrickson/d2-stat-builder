// Answers every same-origin /api/* request inside the browser, so a run never touches
// Bungie, Neon, or Discord. Reads come from the fixture and an in-memory store; writes
// update the store (loadouts, settings, build usage) or are recorded and acknowledged
// (Bungie moves/equips/plugs, bug reports). A route this file doesn't know gets a 501
// and is listed as "unstubbed" in the run summary: that's drift to fix here.
import crypto from "node:crypto";

const json = (status, body) => ({ status, body: JSON.stringify(body) });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIERS = {
  names: [{ hash: 101, name: "Raid" }, { hash: 102, name: "Dungeon" }, { hash: 103, name: "Crucible" }],
  icons: [{ hash: 201, path: "/common/destiny2_content/icons/verify-icon-1.png" }, { hash: 202, path: "/common/destiny2_content/icons/verify-icon-2.png" }],
  colors: [{ hash: 301, path: "/common/destiny2_content/icons/verify-color-1.png" }, { hash: 302, path: "/common/destiny2_content/icons/verify-color-2.png" }],
};

export function createStub({ profile, signedIn = true, seed = {} }) {
  const user = { membershipId: "verify-user", destinyMembershipId: "4611686018400000001", destinyMembershipType: 3, displayName: "Verify Guardian" };
  const store = {
    loadouts: new Map((seed.loadouts ?? []).map((l) => [l.id, l])),
    settings: { ...(seed.settings ?? {}) },
    usage: { pieces: { ...(seed.usage ?? {}) } },
    ingameSlots: seed.ingameSlots ?? Array.from({ length: 10 }, (_, index) => ({ index, nameHash: 101, iconHash: 201, colorHash: 301, items: [], empty: true })),
  };
  /** Every /api request: { t, method, path, body, status }. */
  const requests = [];
  /** Requests no handler recognised. */
  const unstubbed = [];

  const now = () => Date.now();
  const routes = [
    ["GET", /^\/api\/auth\/session$/, () => json(200, signedIn ? { authenticated: true, user } : { authenticated: false })],
    ["POST", /^\/api\/auth\/logout$/, () => json(200, { ok: true })],
    ["GET", /^\/api\/bungie\/profile$/, () => (signedIn ? { status: 200, body: profile } : json(401, { error: "Not signed in" }))],

    ["GET", /^\/api\/loadouts$/, () => json(200, { loadouts: [...store.loadouts.values()] })],
    ["POST", /^\/api\/loadouts$/, (b) => {
      const t = now();
      const row = { ...b, id: crypto.randomUUID(), createdAt: t, updatedAt: t };
      store.loadouts.set(row.id, row);
      return json(201, { loadout: row });
    }],
    ["PUT", /^\/api\/loadouts\/([^/]+)$/, (b, [id]) => {
      if (!store.loadouts.has(id)) return json(404, { error: "Not found" });
      const row = { ...store.loadouts.get(id), ...b, id, updatedAt: now() };
      store.loadouts.set(id, row);
      return json(200, { loadout: row });
    }],
    ["DELETE", /^\/api\/loadouts\/([^/]+)$/, (_, [id]) => (store.loadouts.delete(id) ? json(200, { ok: true }) : json(404, { error: "Not found" }))],
    ["DELETE", /^\/api\/loadouts$/, (b) => {
      const ids = b?.all ? [...store.loadouts.keys()] : (b?.ids ?? []).filter((id) => UUID.test(id) && store.loadouts.has(id));
      for (const id of ids) store.loadouts.delete(id);
      return json(200, { deleted: ids });
    }],

    ["GET", /^\/api\/settings$/, () => json(200, { settings: store.settings })],
    ["PUT", /^\/api\/settings\/([^/]+)$/, (b, [key]) => {
      if (!["links", "pinnedSets", "activitySets"].includes(key)) return json(404, { error: "Unknown setting" });
      if (!Array.isArray(b?.value)) return json(400, { error: "Invalid value" });
      store.settings[key] = { value: b.value, updatedAt: now() };
      return json(200, store.settings[key]);
    }],

    ["GET", /^\/api\/build-usage$/, () => json(200, store.usage)],
    ["POST", /^\/api\/build-usage$/, (b) => {
      for (const [id, used] of b?.pieces ?? []) {
        const p = (store.usage.pieces[id] ??= { eligible: 0, used: 0 });
        p.eligible += 1;
        p.used += used ? 1 : 0;
      }
      return { status: 204, body: "" };
    }],
    ["DELETE", /^\/api\/build-usage$/, () => { store.usage.pieces = {}; return { status: 204, body: "" }; }],

    ["POST", /^\/api\/bungie\/move$/, (b) => json(200, { ok: true, landed: b?.to?.kind === "vault" ? { kind: "vault" } : { kind: "character", characterId: b?.to?.characterId, equipped: Boolean(b?.to?.equip) } })],
    ["POST", /^\/api\/bungie\/lock$/, () => json(200, { ok: true })],
    ["POST", /^\/api\/bungie\/equip$/, (b) => json(200, { results: (b?.items ?? []).map((i) => ({ itemInstanceId: i.itemInstanceId, ok: true })) })],
    ["POST", /^\/api\/bungie\/plugs$/, (b) => json(200, { plugs: (b?.plugs ?? []).map((p) => ({ itemInstanceId: b.itemId, socketIndex: p.socketIndex, plugItemHash: p.plugItemHash, ok: true })) })],
    ["POST", /^\/api\/bungie\/apply-loadout$/, (b) => {
      const equip = (b?.items ?? []).map((i) => ({ itemInstanceId: i.itemInstanceId, ok: true }));
      const plugs = (b?.plugs ?? []).map((p) => ({ ...p, ok: true }));
      const lines = [
        ...equip.flatMap((r) => [{ type: "item-start", itemInstanceId: r.itemInstanceId }, { type: "item", result: r }]),
        ...plugs.flatMap((r) => [{ type: "plug-start", plug: r }, { type: "plug", result: r }]),
        { type: "done", equip, plugs },
      ];
      return { status: 200, body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n", headers: { "content-type": "application/x-ndjson" } };
    }],
    ["POST", /^\/api\/bungie\/apply-loadout\/cancel$/, () => json(200, { ok: true })],
    // The save dialog needs non-empty identifier lists (Bungie's names/icons/colors) to offer a slot.
    ["GET", /^\/api\/bungie\/ingame-loadouts$/, () => json(200, { slots: store.ingameSlots, identifiers: IDENTIFIERS })],
    ["POST", /^\/api\/bungie\/ingame-loadouts$/, () => json(200, { ok: true })],

    ["POST", /^\/api\/bug-reports$/, () => json(201, { id: crypto.randomUUID() })],
  ];

  /** Returns { status, body, headers } or "passthrough". */
  function handle(method, url, postData) {
    const u = new URL(url);
    const path = u.pathname;
    if (path === "/api/favicon") return "passthrough";
    let body;
    try { body = postData ? JSON.parse(postData) : undefined; } catch { body = postData; }
    const entry = { t: new Date().toISOString(), method, path: path + u.search, body };
    requests.push(entry);
    for (const [m, rx, fn] of routes) {
      const match = m === method && rx.exec(path);
      if (match) {
        const res = fn(body, match.slice(1));
        entry.status = res.status;
        return res;
      }
    }
    entry.status = 501;
    unstubbed.push(`${method} ${path}`);
    return json(501, { error: `verify-d2 has no stub for ${method} ${path}` });
  }

  /** Requests that would have changed something on Bungie, Neon, or Discord. */
  const writes = () => requests.filter((r) => r.method !== "GET");
  return { handle, store, requests, writes, unstubbed, user };
}
