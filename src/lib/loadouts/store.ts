// Storage contract for saved loadouts. Rows are owned by a Bungie.net membership id
// (the signed `d2_user` cookie's `membershipId`); every operation is scoped to it so
// an id from another account can never be read or written.
//
// Runtime imports are relative (not `@/`) so the module also runs under vitest.
import type { SavedLoadout, SavedLoadoutData } from "./types";

export interface LoadoutStore {
  list(membershipId: string): Promise<SavedLoadout[]>;
  get(membershipId: string, id: string): Promise<SavedLoadout | null>;
  /** `id` lets an import keep a caller-chosen UUID; otherwise one is minted. */
  create(membershipId: string, data: SavedLoadoutData, id?: string): Promise<SavedLoadout>;
  /** Returns null when the row doesn't exist for this owner. */
  update(membershipId: string, id: string, data: SavedLoadoutData): Promise<SavedLoadout | null>;
  /** Returns false when the row doesn't exist for this owner. */
  delete(membershipId: string, id: string): Promise<boolean>;
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
    const t = this.now();
    const row: SavedLoadout = { ...data, id, createdAt: t, updatedAt: t };
    this.bucket(membershipId).set(id, row);
    return row;
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
}
