// An armor instance for the manager's detail panel: its live stats (component 304, mods
// included), archetype, exotic perk, set bonus, energy, and what's socketed — read from
// the profile's sockets (305) against the manifest's plug definitions.
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import type { Manifest } from "@/lib/manifest/load";
import {
  ARMOR_ARCHETYPE_PLUG_CATEGORY,
  ARMOR_STATS_PLUG_CATEGORY,
  STAT_DISPLAY_ORDER,
  STAT_HASHES,
  type StatKey,
} from "@/lib/armory/stats";
import type { DetailPlug } from "./weapon-details";

export interface SetPerk {
  /** Pieces of the set that must be equipped. */
  count: number;
  name: string;
  description?: string;
}

export interface ArmorDetails {
  stats: { key: StatKey; value: number }[];
  total: number;
  archetype?: DetailPlug;
  /** The exotic's (or other intrinsic) perk. */
  intrinsic?: DetailPlug;
  set?: { name: string; perks: SetPerk[] };
  energy?: { used: number; capacity: number };
  /** Everything else socketed: mods, tuning, masterwork, shader, ornament. */
  plugs: DetailPlug[];
}

const INTRINSIC_CATEGORY = "intrinsics";

function plugInfo(manifest: Manifest, hash: number): DetailPlug | undefined {
  const def = manifest.def("DestinyInventoryItemDefinition", hash);
  if (!def) return undefined;
  return {
    hash,
    name: def.displayProperties?.name || "Unknown",
    ...(def.displayProperties?.icon ? { icon: def.displayProperties.icon } : {}),
    ...(def.displayProperties?.description ? { description: def.displayProperties.description } : {}),
  };
}

/** Empty sockets and the default shader / ornament add nothing worth listing. */
const isPlaceholder = (name: string) => /^(empty\b|default (shader|ornament))/i.test(name);

export function armorDetails(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
  itemHash: number,
): ArmorDetails {
  const live = profile.itemComponents?.stats?.data?.[instanceId]?.stats ?? {};
  const stats = STAT_DISPLAY_ORDER.map((key) => ({ key, value: live[STAT_HASHES[key]]?.value ?? 0 }));
  const details: ArmorDetails = {
    stats,
    total: stats.reduce((sum, s) => sum + s.value, 0),
    plugs: [],
  };

  const energy = profile.itemComponents?.instances?.data?.[instanceId]?.energy;
  if (energy && energy.energyCapacity > 0) {
    details.energy = { used: energy.energyUsed, capacity: energy.energyCapacity };
  }

  const setHash = manifest.def("DestinyInventoryItemDefinition", itemHash)?.equippingBlock?.equipableItemSetHash;
  const set = setHash ? manifest.def("DestinyEquipableItemSetDefinition", setHash) : undefined;
  if (set?.displayProperties?.name) {
    details.set = {
      name: set.displayProperties.name,
      perks: (set.setPerks ?? []).flatMap((p) => {
        const perk = manifest.def("DestinySandboxPerkDefinition", p.sandboxPerkHash)?.displayProperties;
        return perk?.name
          ? [{ count: p.requiredSetCount, name: perk.name, ...(perk.description ? { description: perk.description } : {}) }]
          : [];
      }),
    };
  }

  for (const socket of profile.itemComponents?.sockets?.data?.[instanceId]?.sockets ?? []) {
    if (!socket.plugHash || socket.isVisible === false) continue;
    const category =
      manifest.def("DestinyInventoryItemDefinition", socket.plugHash)?.plug?.plugCategoryIdentifier ?? "";
    if (category === ARMOR_STATS_PLUG_CATEGORY) continue;
    const plug = plugInfo(manifest, socket.plugHash);
    if (!plug || isPlaceholder(plug.name)) continue;
    if (category === ARMOR_ARCHETYPE_PLUG_CATEGORY) details.archetype ??= plug;
    else if (category === INTRINSIC_CATEGORY) details.intrinsic ??= plug;
    else details.plugs.push(plug);
  }
  return details;
}
