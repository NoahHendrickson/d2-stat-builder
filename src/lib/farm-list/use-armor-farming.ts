"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { peekArmory } from "@/lib/armory/use-armory";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { armorFarmKey, matchingArmor } from "./armor";
import { isFarmDone, type ArmorFarmData, type ArmorFarmEntry } from "./types";
import { useFarmList, useFarmListMutations } from "./use-farm-list";

/** One subscription for a whole list of rows: a results list can hold hundreds of pieces. */
export interface ArmorFarming {
  /** The entry already hunting this piece. */
  entryFor(data: ArmorFarmData): ArmorFarmEntry | undefined;
  /** Copies already owned that would match, from the live armory (none if it isn't in yet). */
  owned(data: ArmorFarmData): ArmorPiece[];
  add(data: ArmorFarmData, ignoredInstanceIds?: string[]): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

/** Null until the list has loaded (or when it can't be: signed out, no storage). */
export function useArmorFarming(): ArmorFarming | null {
  const queryClient = useQueryClient();
  const entries = useFarmList().data;
  const { add, remove } = useFarmListMutations();
  const addEntry = add.mutateAsync;
  const removeEntry = remove.mutateAsync;
  return useMemo(() => {
    if (!entries) return null;
    const byKey = new Map<string, ArmorFarmEntry>();
    // A finished entry is a record: the row reads as not on the list, and can be hunted again.
    for (const entry of entries) if (entry.kind === "armor" && !isFarmDone(entry)) byKey.set(armorFarmKey(entry), entry);
    return {
      entryFor: (data) => byKey.get(armorFarmKey(data)),
      owned: (data) => matchingArmor(peekArmory(queryClient)?.pieces ?? [], data),
      add: (data, ignoredInstanceIds = []) => addEntry({ ...data, ignoredInstanceIds }),
      remove: (id) => removeEntry(id),
    };
  }, [entries, queryClient, addEntry, removeEntry]);
}
