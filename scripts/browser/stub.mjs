// Answers every same-origin /api/* request inside the browser, so a run never touches
// Bungie, Neon, or Discord. Reads come from the fixture profile and an in-memory store;
// writes update the store (loadouts, settings, build usage, Farm list) or are recorded and
// acknowledged (Bungie moves/equips/plugs, bug reports). A route this file doesn't know
// gets a 501 and is listed in `unstubbed`: that's drift to fix here. Shared by the benches
// and the verify-d2 skill.
import crypto from "node:crypto";

const json = (status, body) => ({ status, body: JSON.stringify(body) });
const bad = () => json(400, { error: "Invalid request" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUERY_KEY = /^[0-9a-f]{64}$/;
const SYNCED = ["links", "pinnedSets", "activitySets"];
// The in-game save dialog needs non-empty identifier lists (Bungie's names/icons/colors) to offer a slot.
const IDENTIFIERS = {
  names: [{ hash: 101, name: "Raid" }, { hash: 102, name: "Dungeon" }, { hash: 103, name: "Crucible" }],
  icons: [{ hash: 201, path: "/common/destiny2_content/icons/verify-icon-1.png" }, { hash: 202, path: "/common/destiny2_content/icons/verify-icon-2.png" }],
  colors: [{ hash: 301, path: "/common/destiny2_content/icons/verify-color-1.png" }, { hash: 302, path: "/common/destiny2_content/icons/verify-color-2.png" }],
};

export const STUB_USER = { membershipId: "verify-user", destinyMembershipId: "4611686018400000001", destinyMembershipType: 3, displayName: "Verify Guardian" };

/**
 * `profile` is the GetProfile body (a JSON string). `seed` fills the store:
 * `{ loadouts: SavedLoadout[], shares: { [code]: SavedLoadoutData }, settings: { [key]: { value, updatedAt } }, usage: { [queryKey]: [instanceId, 0|1][] }, ingameSlots, farmList: FarmEntry[] }`.
 */
export function createStub({ profile, seed = {} }) {
  const store = {
    loadouts: new Map((seed.loadouts ?? []).map((l) => [l.id, l])),
    settings: { ...seed.settings },
    // Share snapshots by code. Set `sharesDown` to make creating or reading one fail (503).
    shares: new Map(Object.entries(seed.shares ?? {})),
    sharesDown: false,
    // Like the real table: one record per query key, replaced when the query runs again.
    usage: new Map(Object.entries(seed.usage ?? {}).map(([key, pieces]) => [key, new Map(pieces)])),
    ingameSlots: seed.ingameSlots ?? Array.from({ length: 10 }, (_, index) => ({ index, nameHash: 101, iconHash: 201, colorHash: 301, items: [], empty: true })),
    entries: new Map((seed.farmList ?? []).map((e) => [e.id, e])),
  };
  const characterIds = new Set(Object.keys(JSON.parse(profile).characters?.data ?? {}));
  /** Every /api request: { t, method, path, body, status }. */
  const requests = [];
  /** Requests no handler recognised. */
  const unstubbed = [];

  /** The GET /api/build-usage summary: per piece, the queries it could join and those that used it. */
  const usageSummary = () => {
    const pieces = {};
    for (const record of store.usage.values()) {
      for (const [id, used] of record) {
        const p = (pieces[id] ??= { eligible: 0, used: 0 });
        p.eligible += 1;
        p.used += used ? 1 : 0;
      }
    }
    return { pieces };
  };

  const now = () => Date.now();
  const routes = [
    ["GET", /^\/api\/auth\/session$/, () => json(200, { authenticated: true, user: STUB_USER })],
    ["POST", /^\/api\/auth\/logout$/, () => json(200, { ok: true })],
    ["GET", /^\/api\/bungie\/profile$/, () => ({ status: 200, body: profile })],
    ["GET", /^\/api\/dim-share\/([^/]+)$/, (_b, [id]) =>
      id === "abc2345"
        ? json(200, { loadout: { id: "dim-1", name: "From DIM", classType: 1, equipped: [{ hash: 30472172, id: "123" }], unequipped: [{ hash: 1 }], parameters: { mods: [] }, createdAt: 1 } })
        : json(404, { error: "Not found" })],

    ["GET", /^\/api\/loadouts$/, () => json(200, { loadouts: [...store.loadouts.values()] })],
    ["POST", /^\/api\/loadouts$/, (b) => {
      const t = now();
      const stored = (data) => {
        const row = { ...data, id: crypto.randomUUID(), createdAt: t, updatedAt: t };
        store.loadouts.set(row.id, row);
        return row;
      };
      if (Array.isArray(b?.loadouts)) {
        if (b.loadouts.length === 0 || b.loadouts.some((d) => !d?.loadout)) return bad();
        return json(201, { loadouts: b.loadouts.map(stored) });
      }
      if (!b?.loadout) return bad();
      return json(201, { loadout: stored(b) });
    }],
    ["PUT", /^\/api\/loadouts\/([^/]+)$/, (b, [id]) => {
      if (!store.loadouts.has(id)) return json(404, { error: "Not found" });
      if (!b?.loadout) return bad();
      // A fresh updatedAt, or the client keeps its cached copy over the answer.
      const row = { ...store.loadouts.get(id), ...b, id, updatedAt: now() };
      store.loadouts.set(id, row);
      return json(200, { loadout: row });
    }],
    ["DELETE", /^\/api\/loadouts\/([^/]+)$/, (_, [id]) => (store.loadouts.delete(id) ? json(200, { ok: true }) : json(404, { error: "Not found" }))],
    ["POST", /^\/api\/loadout-shares$/, (b) => {
      if (store.sharesDown) return json(503, { error: "Share storage isn't configured", configured: false });
      if (!b?.loadout) return bad();
      const data = { version: b.version, loadout: b.loadout, ...(b.optimizer ? { optimizer: b.optimizer } : {}), ...(b.builder ? { builder: b.builder } : {}) };
      const json_ = JSON.stringify(data);
      const found = [...store.shares].find(([, d]) => JSON.stringify(d) === json_);
      const code = found?.[0] ?? `Share${String(store.shares.size).padStart(5, "0")}`;
      store.shares.set(code, data);
      return json(200, { code });
    }],
    ["GET", /^\/api\/loadout-shares\/([^/]+)$/, (_, [code]) =>
      store.sharesDown ? json(503, { error: "Share storage isn't configured", configured: false })
        : store.shares.has(code) ? json(200, { loadout: store.shares.get(code) }) : json(404, { error: "Share not found" })],
    ["DELETE", /^\/api\/loadouts$/, (b) => {
      if (!Array.isArray(b?.ids)) return bad();
      const ids = b.ids.filter((id) => typeof id === "string" && UUID.test(id) && store.loadouts.has(id));
      for (const id of ids) store.loadouts.delete(id);
      return json(200, { deleted: ids });
    }],

    ["GET", /^\/api\/settings$/, () => json(200, { settings: store.settings })],
    ["PUT", /^\/api\/settings\/([^/]+)$/, (b, [key]) => {
      if (!SYNCED.includes(key)) return json(404, { error: "Unknown setting" });
      if (!Array.isArray(b?.value)) return bad();
      store.settings[key] = { value: b.value, updatedAt: now() };
      return json(200, store.settings[key]);
    }],

    // Mirrors the Farm list store: the first match sticks unless the copy is ignored; "not this
    // one" ignores it and goes back to waiting.
    ["GET", /^\/api\/farm-list$/, () => json(200, { entries: [...store.entries.values()].sort((a, b) => b.createdAt - a.createdAt) })],
    ["POST", /^\/api\/farm-list$/, (b) => {
      if (b?.version !== 1 || !["weapon", "armor"].includes(b.kind)) return bad();
      if (b.kind === "weapon" && (!Array.isArray(b.traits) || b.traits.length !== 2 || !Array.isArray(b.weaponHashes))) return bad();
      if (b.kind === "armor" && (!b.archetype || !Array.isArray(b.rolls) || b.rolls.length === 0)) return bad();
      const row = { ...b, id: crypto.randomUUID(), createdAt: now() };
      store.entries.set(row.id, row);
      return json(201, { entry: row });
    }],
    ["PATCH", /^\/api\/farm-list$/, (b) => {
      if (b?.seen !== true) return bad();
      for (const e of store.entries.values()) if (e.obtained) e.obtained = { ...e.obtained, seen: true };
      return json(200, { ok: true });
    }],
    ["PATCH", /^\/api\/farm-list\/([^/]+)$/, (b, [id]) => {
      const e = store.entries.get(id);
      if (!e) return json(404, { error: "Entry not found" });
      if (typeof b?.obtained === "string" && /^\d{1,20}$/.test(b.obtained)) {
        if (!e.obtained && !e.ignoredInstanceIds.includes(b.obtained)) e.obtained = { instanceId: b.obtained, at: now(), seen: false };
      } else if (b?.reject === true) {
        if (e.obtained) { e.ignoredInstanceIds = [...e.ignoredInstanceIds, e.obtained.instanceId]; delete e.obtained; }
      } else if (b?.done === true) {
        if (e.obtained && e.obtained.doneAt === undefined) e.obtained = { ...e.obtained, doneAt: now() };
      } else return bad();
      return json(200, { entry: e });
    }],
    ["DELETE", /^\/api\/farm-list\/([^/]+)$/, (_, [id]) => (store.entries.delete(id) ? json(200, { ok: true }) : json(404, { error: "Entry not found" }))],

    ["GET", /^\/api\/build-usage$/, () => json(200, usageSummary())],
    ["POST", /^\/api\/build-usage$/, (b) => {
      // Mirrors decodeRecord, except instance ids aren't checked to be numeric (the fixture's are `instN`).
      if (typeof b?.key !== "string" || !QUERY_KEY.test(b.key) || !Array.isArray(b.pieces) || b.pieces.length === 0) return bad();
      const record = new Map();
      for (const entry of b.pieces) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || (entry[1] !== 0 && entry[1] !== 1)) return bad();
        if (!record.has(entry[0])) record.set(entry[0], entry[1] === 1);
      }
      store.usage.set(b.key, record);
      return { status: 204, body: "" };
    }],
    ["DELETE", /^\/api\/build-usage$/, () => { store.usage.clear(); return { status: 204, body: "" }; }],

    ["POST", /^\/api\/bungie\/move$/, (b) => {
      if (!b?.to?.kind) return bad();
      return json(200, { ok: true, landed: b.to.kind === "vault" ? { kind: "vault" } : { kind: "character", characterId: b.to.characterId, equipped: Boolean(b.to.equip) } });
    }],
    ["POST", /^\/api\/bungie\/lock$/, (b) => (typeof b?.locked === "boolean" ? json(200, { ok: true }) : bad())],
    ["POST", /^\/api\/bungie\/equip$/, (b) => (Array.isArray(b?.items) ? json(200, { results: b.items.map((i) => ({ itemInstanceId: i.itemInstanceId, ok: true })) }) : bad())],
    ["POST", /^\/api\/bungie\/plugs$/, (b) => (Array.isArray(b?.plugs) ? json(200, { plugs: b.plugs.map((p) => ({ itemInstanceId: b.itemId, socketIndex: p.socketIndex, plugItemHash: p.plugItemHash, ok: true })) }) : bad())],
    ["POST", /^\/api\/bungie\/apply-loadout$/, (b) => {
      if (!Array.isArray(b?.items)) return bad();
      const equip = b.items.map((i) => ({ itemInstanceId: i.itemInstanceId, ok: true }));
      const plugs = (Array.isArray(b.plugs) ? b.plugs : []).map((p) => ({ ...p, ok: true }));
      const lines = [
        ...equip.flatMap((r) => [{ type: "item-start", itemInstanceId: r.itemInstanceId }, { type: "item", result: r }]),
        ...plugs.flatMap((r) => [{ type: "plug-start", plug: r }, { type: "plug", result: r }]),
        { type: "done", equip, plugs },
      ];
      return { status: 200, body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n", headers: { "content-type": "application/x-ndjson" } };
    }],
    ["POST", /^\/api\/bungie\/apply-loadout\/cancel$/, () => json(200, { ok: true })],
    ["GET", /^\/api\/bungie\/ingame-loadouts$/, () => json(200, { slots: store.ingameSlots, identifiers: IDENTIFIERS })],
    ["POST", /^\/api\/bungie\/ingame-loadouts$/, (b) => (Number.isInteger(b?.loadoutIndex) ? json(200, { ok: true }) : bad())],
    ["PATCH", /^\/api\/bungie\/ingame-loadouts$/, (b) => {
      const slot = store.ingameSlots[b?.loadoutIndex];
      if (!characterIds.has(b?.characterId) || !slot || ![b.nameHash, b.iconHash, b.colorHash].every(Number.isInteger)) return bad();
      store.ingameSlots[b.loadoutIndex] = { ...slot, nameHash: b.nameHash, iconHash: b.iconHash, colorHash: b.colorHash };
      return json(200, { ok: true });
    }],
    ["DELETE", /^\/api\/bungie\/ingame-loadouts$/, (b) => {
      // Like the route's parseSlotRequest, but the fixture's character ids aren't numeric
      // ("c1"), so the id must be one of its characters instead.
      if (!characterIds.has(b?.characterId) || !Number.isInteger(b?.loadoutIndex) || b.loadoutIndex < 0 || b.loadoutIndex > 31) return bad();
      const slot = store.ingameSlots[b.loadoutIndex];
      if (!slot) return bad();
      // Bungie empties the slot and resets its labels.
      store.ingameSlots[b.loadoutIndex] = { index: slot.index, nameHash: 101, iconHash: 201, colorHash: 301, items: [], empty: true };
      return json(200, { ok: true });
    }],

    ["POST", /^\/api\/bug-reports$/, () => json(201, { id: crypto.randomUUID() })],
  ];

  /** Returns `{ status, body, headers? }`, or "passthrough" to let the request reach the server. */
  function handle(method, url, postData) {
    const u = new URL(url);
    if (u.pathname === "/api/favicon") return "passthrough";
    let body;
    try { body = postData ? JSON.parse(postData) : undefined; } catch { body = postData; }
    const entry = { t: new Date().toISOString(), method, path: u.pathname + u.search, body };
    requests.push(entry);
    for (const [m, rx, fn] of routes) {
      const match = m === method && rx.exec(u.pathname);
      if (match) {
        const res = fn(body, match.slice(1));
        entry.status = res.status;
        return res;
      }
    }
    entry.status = 501;
    unstubbed.push(`${method} ${u.pathname}`);
    return json(501, { error: `no stub for ${method} ${u.pathname}` });
  }

  /** CDP `Fetch.requestPaused` handler for `launchBrowser({ onRequest })`. */
  async function onRequest({ requestId, request }, page) {
    const res = handle(request.method, request.url, request.postData);
    if (res === "passthrough") return page.continueRequest(requestId);
    await page.fulfill(requestId, res.status, res.body, res.headers ?? { "content-type": "application/json" });
  }

  return {
    handle, onRequest, store, requests, unstubbed, user: STUB_USER,
    /** Requests that would have changed something on Bungie, Neon, or Discord. */
    writes: () => requests.filter((r) => r.method !== "GET"),
    /** The latest request with this method whose path starts with `pathPrefix`. */
    last: (method, pathPrefix) => requests.filter((r) => r.method === method && r.path.startsWith(pathPrefix)).at(-1),
  };
}
