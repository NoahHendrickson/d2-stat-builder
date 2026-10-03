import { NextResponse } from "next/server";
import {
  getDestinyManifest,
  getProfile,
  snapshotLoadout,
  type DestinyComponentType,
  type DestinyLoadoutColorDefinition,
  type DestinyLoadoutIconDefinition,
  type DestinyLoadoutNameDefinition,
} from "bungie-api-ts/destiny2";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { createBungieHttp } from "@/lib/bungie/http";
import { bungieErrorResponse } from "@/lib/bungie/equip-route";
import {
  isBungieId,
  parseSnapshotRequest,
  toSlots,
  type InGameLoadoutIdentifiers,
  type InGameLoadoutsResponse,
} from "@/lib/bungie/ingame-loadouts";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";

// 206 CharacterLoadouts, plus the item lists that turn a slot's instance ids into item
// hashes for the preview: 102 Vault · 201 CharacterInventories · 205 CharacterEquipment.
const COMPONENTS = [206, 102, 201, 205] as DestinyComponentType[];

/**
 * The name / icon / colour lists are three tiny manifest tables (~9 KB together) that
 * only this route reads, so they are fetched here on demand instead of joining the
 * client manifest — adding a table there re-downloads the whole manifest for everyone.
 * Kept per server instance; they change only when Bungie ships new identifiers.
 */
const IDENTIFIERS_TTL_MS = 60 * 60_000;
let identifiersCache: { at: number; value: InGameLoadoutIdentifiers } | undefined;

type Table<T> = Record<string, T>;
type Def = { hash: number; index: number; redacted?: boolean };

async function fetchTable<T>(path: string | undefined): Promise<T[]> {
  if (!path) throw new Error("Bungie's manifest is missing the loadout identifier tables");
  const res = await fetch(`${BUNGIE_IMAGE_BASE}${path}`);
  if (!res.ok) throw new Error(`Bungie manifest table request failed (HTTP ${res.status})`);
  return Object.values((await res.json()) as Table<T>);
}

/** In the game's own order, without the entries Bungie hasn't revealed yet. */
const visible = <T extends Def>(defs: T[]) =>
  defs.filter((d) => !d.redacted).sort((a, b) => a.index - b.index);

async function loadIdentifiers(): Promise<InGameLoadoutIdentifiers> {
  if (identifiersCache && Date.now() - identifiersCache.at < IDENTIFIERS_TTL_MS) {
    return identifiersCache.value;
  }
  const info = (await getDestinyManifest(createBungieHttp())).Response;
  const paths = info.jsonWorldComponentContentPaths.en;
  const [names, icons, colors] = await Promise.all([
    fetchTable<DestinyLoadoutNameDefinition>(paths.DestinyLoadoutNameDefinition),
    fetchTable<DestinyLoadoutIconDefinition>(paths.DestinyLoadoutIconDefinition),
    fetchTable<DestinyLoadoutColorDefinition>(paths.DestinyLoadoutColorDefinition),
  ]);
  const value: InGameLoadoutIdentifiers = {
    names: visible(names)
      .filter((d) => d.name)
      .map((d) => ({ hash: d.hash, name: d.name })),
    icons: visible(icons)
      .filter((d) => d.iconImagePath)
      .map((d) => ({ hash: d.hash, path: d.iconImagePath })),
    colors: visible(colors)
      .filter((d) => d.colorImagePath)
      .map((d) => ({ hash: d.hash, path: d.colorImagePath })),
  };
  identifiersCache = { at: Date.now(), value };
  return value;
}

/** A character's in-game loadout slots, plus the identifiers a slot can be given. */
export async function GET(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!isBungieId(characterId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // GetProfile, not GetCharacter: the per-character endpoint is documented to carry
    // this component but comes back without it.
    const [profile, identifiers] = await Promise.all([
      getProfile(createBungieHttp(token), {
        destinyMembershipId: user.destinyMembershipId,
        membershipType: user.destinyMembershipType,
        components: COMPONENTS,
      }),
      loadIdentifiers(),
    ]);
    const component = profile.Response?.characterLoadouts;
    const loadouts = component?.data?.[characterId]?.loadouts;
    if (!loadouts) {
      console.error("GET /api/bungie/ingame-loadouts: no loadouts in the profile response", {
        responseKeys: Object.keys(profile.Response ?? {}),
        privacy: component?.privacy,
        characters: Object.keys(component?.data ?? {}),
        characterId,
      });
      return NextResponse.json(
        { error: "Bungie didn't return this character's in-game loadouts" },
        { status: 502 },
      );
    }
    const hashes = new Map<string, number>();
    const lists = [
      profile.Response.profileInventory?.data,
      ...Object.values(profile.Response.characterInventories?.data ?? {}),
      ...Object.values(profile.Response.characterEquipment?.data ?? {}),
    ];
    for (const list of lists) {
      for (const item of list?.items ?? []) {
        if (item.itemInstanceId) hashes.set(item.itemInstanceId, item.itemHash);
      }
    }
    return NextResponse.json({
      slots: toSlots(loadouts, (id) => hashes.get(id)),
      identifiers,
    } satisfies InGameLoadoutsResponse);
  } catch (err) {
    return bungieErrorResponse(err);
  }
}

/**
 * Save what the character has equipped right now into one of its in-game loadout
 * slots, replacing whatever the slot held. Bungie offers no way to write a slot's
 * contents directly, so the caller equips the loadout first (see ingame-save.ts).
 */
export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: ReturnType<typeof parseSnapshotRequest> = null;
  try {
    body = parseSnapshotRequest(await request.json());
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    await snapshotLoadout(createBungieHttp(token), {
      ...body,
      membershipType: user.destinyMembershipType,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return bungieErrorResponse(err);
  }
}
