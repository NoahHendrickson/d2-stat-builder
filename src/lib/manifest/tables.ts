import type {
  DestinyInventoryItemDefinition,
  DestinyStatDefinition,
  DestinyStatGroupDefinition,
  DestinyEquipableItemSetDefinition,
  DestinySandboxPerkDefinition,
  DestinyPlugSetDefinition,
  DestinySocketTypeDefinition,
  DestinyClassDefinition,
  DestinyDamageTypeDefinition,
  DestinySeasonDefinition,
} from "bungie-api-ts/destiny2";

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
] as const;

export type ManifestTableName = (typeof MANIFEST_TABLES)[number];

/** A manifest table is a map of definition hash -> definition. */
export type DefinitionTable<T> = Record<number, T>;

export interface ManifestTables {
  DestinyInventoryItemDefinition: DefinitionTable<DestinyInventoryItemDefinition>;
  DestinyStatDefinition: DefinitionTable<DestinyStatDefinition>;
  DestinyStatGroupDefinition: DefinitionTable<DestinyStatGroupDefinition>;
  DestinyEquipableItemSetDefinition: DefinitionTable<DestinyEquipableItemSetDefinition>;
  DestinySandboxPerkDefinition: DefinitionTable<DestinySandboxPerkDefinition>;
  DestinyPlugSetDefinition: DefinitionTable<DestinyPlugSetDefinition>;
  DestinySocketTypeDefinition: DefinitionTable<DestinySocketTypeDefinition>;
  DestinyClassDefinition: DefinitionTable<DestinyClassDefinition>;
  DestinyDamageTypeDefinition: DefinitionTable<DestinyDamageTypeDefinition>;
  DestinySeasonDefinition: DefinitionTable<DestinySeasonDefinition>;
}
