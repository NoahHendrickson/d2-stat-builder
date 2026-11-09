// Storage contract for saved loadouts. Rows are owned by a Bungie.net membership id
// (the signed `d2_user` cookie's `membershipId`); every operation is scoped to it so
// an id from another account can never be read or written.
//
// Runtime imports are relative (not `@/`) so the module also runs under vitest.
import type { SavedLoadout, SavedLoadoutData } from "./types";

/** Most loadouts one account may keep — far past real use, but bounds what one account can store. */
export const MAX_LOADOUTS_PER_ACCOUNT = 1000;

/** Thrown by `create` when the owner already has MAX_LOADOUTS_PER_ACCOUNT rows. */
export class LoadoutLimitError extends Error {
  constructor() {
    super(`Loadout limit reached (${MAX_LOADOUTS_PER_ACCOUNT})`);
    this.name = "LoadoutLimitError";
  }
}

export interface LoadoutStore {
  list(membershipId: string): Promise<SavedLoadout[]>;
  get(membershipId: string, id: string): Promise<SavedLoadout | null>;
  /**
   * `id` lets an import keep a caller-chosen UUID; otherwise one is minted. Throws
   * LoadoutLimitError when the owner is at MAX_LOADOUTS_PER_ACCOUNT.
   */
  create(membershipId: string, data: SavedLoadoutData, id?: string): Promise<SavedLoadout>;
  /**
   * Stores every row or none, and returns them in the order given. Throws
   * LoadoutLimitError when they wouldn't all fit under MAX_LOADOUTS_PER_ACCOUNT.
   */
  createMany(membershipId: string, data: readonly SavedLoadoutData[]): Promise<SavedLoadout[]>;
  /** Returns null when the row doesn't exist for this owner. */
  update(membershipId: string, id: string, data: SavedLoadoutData): Promise<SavedLoadout | null>;
  /** Returns false when the row doesn't exist for this owner. */
  delete(membershipId: string, id: string): Promise<boolean>;
  /** Deletes the given rows; returns the ids actually removed. */
  deleteMany(membershipId: string, ids: readonly string[]): Promise<string[]>;
}

/** In-memory store — unit tests and a fallback when no database is configured. */
export class MemoryLoadoutStore implements LoadoutStore {
  private rows = new Map<string, Map<string, SavedLoadout>>();
  constructor(private readonly now: () => number = Date.now) {}

  private bucket(membershipId: string) {
    let b = this.rows.get(membershipId);
    if (!b) {
      b = new Map();
      this.rows.set(membershipId, b);
    }
    return b;
  }

  async list(membershipId: string) {
    return [...this.bucket(membershipId).values()].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async get(membershipId: string, id: string) {
    return this.bucket(membershipId).get(id) ?? null;
  }

  async create(membershipId: string, data: SavedLoadoutData, id = crypto.randomUUID()) {
    if (this.bucket(membershipId).size >= MAX_LOADOUTS_PER_ACCOUNT) throw new LoadoutLimitError();
    const t = this.now();
    const row: SavedLoadout = { ...data, id, createdAt: t, updatedAt: t };
    this.bucket(membershipId).set(id, row);
    return row;
  }

  async createMany(membershipId: string, data: readonly SavedLoadoutData[]) {
    if (this.bucket(membershipId).size + data.length > MAX_LOADOUTS_PER_ACCOUNT) {
      throw new LoadoutLimitError();
    }
    return Promise.all(data.map((d) => this.create(membershipId, d)));
  }

  async update(membershipId: string, id: string, data: SavedLoadoutData) {
    const existing = this.bucket(membershipId).get(id);
    if (!existing) return null;
    const row: SavedLoadout = {
      ...data,
      id,
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    };
    this.bucket(membershipId).set(id, row);
    return row;
  }

  async delete(membershipId: string, id: string) {
    return this.bucket(membershipId).delete(id);
  }

  async deleteMany(membershipId: string, ids: readonly string[]) {
    const bucket = this.bucket(membershipId);
    return ids.filter((id) => bucket.delete(id));
  }
}
