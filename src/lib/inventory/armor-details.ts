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
  STAT_HASH_TO_INDEX,
  STAT_ORDER,
  TUNING_PLUG_CATEGORY,
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
  archetype?: DetailPlug;
  /** The exotic's (or other intrinsic) perk. */
  intrinsic?: DetailPlug;
  set?: { name: string; perks: SetPerk[] };
  energy?: { used: number; capacity: number };
  /**
   * The stat a Tier 5 piece's tuning adds +5 to, or "any" when it can tune any stat
   * (exotics). Undefined when it can't be tuned.
   */
  tunable?: StatKey | "any";
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

/**
 * The stats the piece's directional tuning plugs (+5 to one stat, −5 to another) can
 * raise, from the tuning socket's options (component 310). A legendary rolls one; an
 * exotic offers them all.
 */
function tunableStat(
  profile: DestinyProfileResponse,
  manifest: Manifest,
  instanceId: string,
): ArmorDetails["tunable"] {
  const raised = new Set<StatKey>();
  for (const plugs of Object.values(profile.itemComponents?.reusablePlugs?.data?.[instanceId]?.plugs ?? {})) {
    for (const { plugItemHash } of plugs) {
      const def = manifest.def("DestinyInventoryItemDefinition", plugItemHash);
      if (!def?.plug?.plugCategoryIdentifier?.includes(TUNING_PLUG_CATEGORY)) continue;
      const investments = def.investmentStats ?? [];
      // Balanced Tuning only adds, so it says nothing about the tuned stat.
      if (!investments.some((s) => s.value < 0)) continue;
      const plus = investments.find((s) => s.value > 0);
      const index = plus ? STAT_HASH_TO_INDEX[plus.statTypeHash] : undefined;
      if (index !== undefined) raised.add(STAT_ORDER[index]!);
    }
  }
  if (raised.size === 0) return undefined;
  return raised.size === 1 ? [...raised][0] : "any";
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
    plugs: [],
  };

  const energy = profile.itemComponents?.instances?.data?.[instanceId]?.energy;
  if (energy && energy.energyCapacity > 0) {
    details.energy = { used: energy.energyUsed, capacity: energy.energyCapacity };
  }

  const tunable = tunableStat(profile, manifest, instanceId);
  if (tunable) details.tunable = tunable;

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
