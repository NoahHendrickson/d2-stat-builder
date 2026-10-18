import type {
  DestinyInventoryItemDefinition,
  DestinyItemSocketEntryPlugItemDefinition,
} from "bungie-api-ts/destiny2";

import type { StatMod } from "./types";

type SocketPlugSetEntry = { plugItemHash: number; currentlyCanRoll?: boolean };

/** Plug definition subset needed to read a randomized pool's layout. */
type PoolPlugDefs = Record<
  number,
  Pick<DestinyInventoryItemDefinition, "displayProperties" | "inventory" | "plug"> | undefined
>;

/** Socket entry subset needed for rollability heuristics. */
export interface SocketPlugSource {
  randomizedPlugSetHash?: number;
  reusablePlugSetHash?: number;
  singleInitialItemHash?: number;
  /** Plugs listed on the socket itself rather than in a plug set. */
  reusablePlugItems?: Pick<DestinyItemSocketEntryPlugItemDefinition, "plugItemHash">[];
}

/**
 * Whether a manifest plug-set entry should be treated as currently rollable.
 *
 * `currentlyCanRoll` carries no signal for randomized weapon pools: every entry in
 * every one is `true` (older manifests had them all `false`). Membership is the
 * baseline signal, narrowed by `pairedPoolPlugs` when plug definitions are
 * available. The flag is only meaningful for reusable-only pools (fixed/curated options).
 */
export function plugSetEntryCanRoll(
  socketEntry: SocketPlugSource,
  plugSetHash: number,
  plugEntry: SocketPlugSetEntry,
): boolean {
  if (
    socketEntry.randomizedPlugSetHash != null &&
    plugSetHash === socketEntry.randomizedPlugSetHash
  ) {
    return true;
  }
  return plugEntry.currentlyCanRoll ?? false;
}

/**
 * The plugs that can actually roll from a randomized barrel/magazine-style pool.
 *
 * Bungie lays pools out as `[base perks][their enhanced versions][later additions]`.
 * Base perks without a partner in that first enhanced run (Sticky Grenades on heavy
 * GLs) and everything after it (Full Choke on hand cannon barrels) are listed but
 * never drop. Trait pools are left alone: their later blocks do roll. Returns
 * undefined when the rule doesn't apply. destiny.report filters the same way.
 */
export function pairedPoolPlugs(
  plugItemHashes: number[],
  items: PoolPlugDefs,
): Set<number> | undefined {
  const isEnhanced = (hash: number) => items[hash]?.inventory?.tierType === 3;
  // "Golden Tricorn Enhanced" pairs with "Golden Tricorn".
  const name = (hash: number) =>
    (items[hash]?.displayProperties?.name ?? "").replace(/ Enhanced$/, "");
  const isEmpty = (hash: number) =>
    Boolean(items[hash]?.plug?.plugCategoryIdentifier?.includes("empty")) ||
    /^Empty .* Socket$/.test(items[hash]?.displayProperties?.name ?? "");

  const plugs = plugItemHashes.filter((hash) => !isEmpty(hash));
  if (plugs.some((hash) => items[hash]?.plug?.plugCategoryIdentifier === "frames")) return undefined;

  let i = 0;
  const base: number[] = [];
  while (i < plugs.length && !isEnhanced(plugs[i]!)) base.push(plugs[i++]!);
  const enhanced: number[] = [];
  while (i < plugs.length && isEnhanced(plugs[i]!)) enhanced.push(plugs[i++]!);
  if (enhanced.length === 0) return undefined;

  const enhancedNames = new Set(enhanced.map(name));
  return new Set([...base.filter((hash) => enhancedNames.has(name(hash))), ...enhanced]);
}

/**
 * Collect deduped plug candidates for one socket, OR-merging rollability per hash.
 * Pass `items` to drop never-rolling entries from randomized pools (see `pairedPoolPlugs`).
 *
 * A random pool is the socket's full option list; the plugs the socket lists itself
 * are only its curated roll. Any other socket also offers the plugs it lists itself,
 * after its plug set and initial plug: origin sockets list their choices there
 * (Yeartide Apex: Dream Work or Tex Balanced Stock), with no plug set or one holding
 * only the crafting empty socket.
 */
export function collectSocketPlugCandidates(
  socketEntry: SocketPlugSource,
  plugSets: Record<number, { reusablePlugItems?: SocketPlugSetEntry[] }>,
  items?: PoolPlugDefs,
): { hash: number; canRoll: boolean }[] {
  const plugSetHash = socketEntry.randomizedPlugSetHash ?? socketEntry.reusablePlugSetHash;
  const pool = plugSetHash != null ? (plugSets[plugSetHash]?.reusablePlugItems ?? []) : [];
  const poolHashes = pool.map((plug) => plug.plugItemHash);
  const paired =
    items && plugSetHash === socketEntry.randomizedPlugSetHash
      ? pairedPoolPlugs(poolHashes, items)
      : undefined;
  const rulesOut = (hash: number) => paired != null && !paired.has(hash) && poolHashes.includes(hash);

  const options: [hash: number, canRoll: boolean][] =
    plugSetHash == null
      ? []
      : pool
          .filter((plug) => !rulesOut(plug.plugItemHash))
          .map((plug) => [plug.plugItemHash, plugSetEntryCanRoll(socketEntry, plugSetHash, plug)]);
  // Fixed socket plug, merged regardless (older raid weapons pair it with a crafting
  // empty-socket plug set). A curated default the paired pool rules out stays out:
  // VS Chill Inhibitor ships with Sticky Grenades, but no random roll can have it.
  const initial = socketEntry.singleInitialItemHash;
  if (initial && !rulesOut(initial)) options.push([initial, true]);
  if (socketEntry.randomizedPlugSetHash == null) {
    for (const { plugItemHash } of socketEntry.reusablePlugItems ?? []) {
      options.push([plugItemHash, true]);
    }
  }

  const byHash = new Map<number, boolean>();
  for (const [hash, canRoll] of options) byHash.set(hash, byHash.get(hash) || canRoll);
  return [...byHash.entries()].map(([hash, canRoll]) => ({ hash, canRoll }));
}

/**
 * A weapon socket's drop candidates plus what its crafting pattern's socket adds.
 * Pattern-only plugs (Sticky Grenades on Tarnation) come back `craftedOnly`. A perk in
 * both pools keeps the drop pool's hash, since `buildColumnPerks` keeps the last hash
 * per name, and is rollable if either pool can roll it. Pattern plugs outside the drop
 * pool's plug categories are skipped, so a pattern socket that stops lining up with
 * the weapon's adds nothing.
 */
export function withPatternPlugCandidates(
  dropCandidates: { hash: number; canRoll: boolean }[],
  patternEntry: SocketPlugSource,
  plugSets: Record<number, { reusablePlugItems?: SocketPlugSetEntry[] }>,
  items: PoolPlugDefs,
): { hash: number; canRoll: boolean; craftedOnly?: true }[] {
  const name = (hash: number) => items[hash]?.displayProperties?.name;
  const category = (hash: number) => items[hash]?.plug?.plugCategoryIdentifier;
  const dropNames = new Set(dropCandidates.map(({ hash }) => name(hash)));
  const dropCategories = new Set(dropCandidates.map(({ hash }) => category(hash)));

  const craftableNames = new Set<string | undefined>();
  const craftedOnly: { hash: number; canRoll: boolean; craftedOnly: true }[] = [];
  for (const plug of collectSocketPlugCandidates(patternEntry, plugSets, items)) {
    if (!dropCategories.has(category(plug.hash))) continue;
    if (!dropNames.has(name(plug.hash))) craftedOnly.push({ ...plug, craftedOnly: true });
    else if (plug.canRoll) craftableNames.add(name(plug.hash));
  }
  return [
    ...dropCandidates.map((plug) =>
      craftableNames.has(name(plug.hash)) ? { ...plug, canRoll: true } : plug,
    ),
    ...craftedOnly,
  ];
}

/** Non-conditional investment stat modifiers from a plug definition. */
export function extractPlugStatMods(def: DestinyInventoryItemDefinition): StatMod[] | undefined {
  const mods: StatMod[] = [];
  for (const inv of def.investmentStats ?? []) {
    if (inv.isConditionallyActive || inv.value === 0) continue;
    mods.push({ hash: inv.statTypeHash, value: inv.value });
  }
  return mods.length > 0 ? mods : undefined;
}
