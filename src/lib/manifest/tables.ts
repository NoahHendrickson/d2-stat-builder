import type {
  DestinyStatDefinition,
  DestinyStatGroupDefinition,
  DestinyEquipableItemSetDefinition,
  DestinySandboxPerkDefinition,
  DestinyPlugSetDefinition,
  DestinySocketTypeDefinition,
  DestinyClassDefinition,
  DestinyDamageTypeDefinition,
  DestinySeasonDefinition,
  DestinyMaterialRequirementSetDefinition,
} from "bungie-api-ts/destiny2";
import type { ItemDef } from "./item-def";

/** The manifest definition tables this app needs for armor optimization. */
export const MANIFEST_TABLES = [
  "DestinyInventoryItemDefinition",
  "DestinyStatDefinition",
  "DestinyStatGroupDefinition",
  "DestinyEquipableItemSetDefinition",
  "DestinySandboxPerkDefinition",
  "DestinyPlugSetDefinition",
  "DestinySocketTypeDefinition",
  "DestinyClassDefinition",
  "DestinyDamageTypeDefinition",
  // Tiny; maps the profile's currentSeasonHash → seasonNumber for saved artifact perks.
  "DestinySeasonDefinition",
  // Tiny; what each armor masterwork level costs (glimmer, cores, prisms, shards).
  "DestinyMaterialRequirementSetDefinition",
] as const;

export type ManifestTableName = (typeof MANIFEST_TABLES)[number];

/** A manifest table is a map of definition hash -> definition. */
export type DefinitionTable<T> = Record<number, T>;

export interface ManifestTables {
  /** Projected to the fields the app reads — see item-def.ts. */
  DestinyInventoryItemDefinition: DefinitionTable<ItemDef>;
  DestinyStatDefinition: DefinitionTable<DestinyStatDefinition>;
  DestinyStatGroupDefinition: DefinitionTable<DestinyStatGroupDefinition>;
  DestinyEquipableItemSetDefinition: DefinitionTable<DestinyEquipableItemSetDefinition>;
  DestinySandboxPerkDefinition: DefinitionTable<DestinySandboxPerkDefinition>;
  DestinyPlugSetDefinition: DefinitionTable<DestinyPlugSetDefinition>;
  DestinySocketTypeDefinition: DefinitionTable<DestinySocketTypeDefinition>;
  DestinyClassDefinition: DefinitionTable<DestinyClassDefinition>;
  DestinyDamageTypeDefinition: DefinitionTable<DestinyDamageTypeDefinition>;
  DestinySeasonDefinition: DefinitionTable<DestinySeasonDefinition>;
  DestinyMaterialRequirementSetDefinition: DefinitionTable<DestinyMaterialRequirementSetDefinition>;
}
