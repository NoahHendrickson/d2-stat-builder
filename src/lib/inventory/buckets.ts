/** Inventory bucket hashes the manager lays out (DestinyInventoryBucketDefinition). */
export const BUCKETS = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
  helmet: 3448274439,
  arms: 3551918588,
  chest: 14239492,
  legs: 20886954,
  classItem: 1585787867,
  ghost: 4023194814,
  vehicle: 2025709351,
  ships: 284967655,
  consumables: 1469714392,
  modifications: 3313201758,
  /** Lost Items: character-scoped, but its items can be anything. */
  postmaster: 215593132,
  /** The vault ("General"): every vault item reports this live bucket. */
  vault: 138197802,
} as const;

export interface BucketRow {
  hash: number;
  label: string;
}

export interface BucketGroup {
  label: string;
  rows: BucketRow[];
}

/** The character grid, top to bottom: weapons, then armor, then the rest of the gear. */
export const CHARACTER_GROUPS: BucketGroup[] = [
  {
    label: "Weapons",
    rows: [
      { hash: BUCKETS.kinetic, label: "Kinetic" },
      { hash: BUCKETS.energy, label: "Energy" },
      { hash: BUCKETS.power, label: "Power" },
    ],
  },
  {
    label: "Armor",
    rows: [
      { hash: BUCKETS.helmet, label: "Helmet" },
      { hash: BUCKETS.arms, label: "Arms" },
      { hash: BUCKETS.chest, label: "Chest" },
      { hash: BUCKETS.legs, label: "Legs" },
      { hash: BUCKETS.classItem, label: "Class item" },
    ],
  },
  {
    label: "General",
    rows: [
      { hash: BUCKETS.ghost, label: "Ghost" },
      { hash: BUCKETS.vehicle, label: "Sparrow" },
      { hash: BUCKETS.ships, label: "Ship" },
    ],
  },
];

/** Vault sections follow the character rows; anything else lands in "Other". */
export const VAULT_GROUPS: BucketGroup[] = CHARACTER_GROUPS;

/** Account-wide inventories (not in the vault, reachable from every character). */
export const ACCOUNT_ROWS: BucketRow[] = [
  { hash: BUCKETS.consumables, label: "Consumables" },
  { hash: BUCKETS.modifications, label: "Modifications" },
];

/** Every bucket shown as its own vault row; the rest of the vault is "Other". */
export const VAULT_ROW_HASHES: ReadonlySet<number> = new Set(
  VAULT_GROUPS.flatMap((g) => g.rows.map((r) => r.hash)),
);
