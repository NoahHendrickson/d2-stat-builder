// An activity set while it's being edited. Nothing here is stored until Save: `copies`
// holds gear kept only for this set, by the temporary loadout id its slots use for it.
// Pure — runtime imports stay relative so the module runs under vitest.
import type { SlotIdentifiers } from "../bungie/ingame-loadouts";
import type { ActivitySetRunState } from "./activity-set-run";
import { withSlotAssignment, withSlotLabels, type ActivitySet } from "./activity-sets";
import { transientLoadout, type SavedLoadout, type SavedLoadoutData } from "./types";

export interface SetDraft {
  set: ActivitySet;
  copies: Readonly<Record<string, SavedLoadoutData>>;
}

/** Gear to keep in one of a set's slots, private to that set. */
export interface SlotCopy {
  index: number;
  data: SavedLoadoutData;
  labels?: SlotIdentifiers;
}

export function newSetDraft(characterId: string, classType: number): SetDraft {
  return {
    set: { id: crypto.randomUUID(), name: "", characterId, classType, slots: [] },
    copies: {},
  };
}

/** A working copy of a set that's already saved. */
export function draftFromSet(set: ActivitySet): SetDraft {
  return { set, copies: {} };
}

/** The copies a slot's previous occupant no longer needs are dropped with it. */
function copiesWithoutSlot(draft: SetDraft, index: number): SetDraft["copies"] {
  const previous = draft.set.slots.find((s) => s.index === index)?.loadoutId;
  return Object.fromEntries(Object.entries(draft.copies).filter(([id]) => id !== previous));
}

/** Put a loadout in a slot, or leave the slot alone when `loadoutId` is undefined. */
export function withSlotLoadout(
  draft: SetDraft,
  index: number,
  loadoutId: string | undefined,
): SetDraft {
  return {
    set: withSlotAssignment(draft.set, index, loadoutId),
    copies: copiesWithoutSlot(draft, index),
  };
}

/** Give a slot its own copy of some gear. It's stored when the set is saved. */
export function withSlotCopy(
  draft: SetDraft,
  { index, data, labels }: SlotCopy,
  id: string = crypto.randomUUID(),
): SetDraft {
  const assigned = withSlotAssignment(draft.set, index, id);
  return {
    set: labels ? withSlotLabels(assigned, index, labels) : assigned,
    copies: { ...copiesWithoutSlot(draft, index), [id]: { ...data, setOnly: true } },
  };
}

/** A new set holding a copy of each of these slots. */
export function draftFromSlots(
  characterId: string,
  classType: number,
  slots: readonly SlotCopy[],
): SetDraft {
  return slots.reduce((draft, slot) => withSlotCopy(draft, slot), newSetDraft(characterId, classType));
}

export function withDraftName(draft: SetDraft, name: string): SetDraft {
  return { ...draft, set: { ...draft.set, name } };
}

export function withDraftSlotLabels(
  draft: SetDraft,
  index: number,
  labels: SlotIdentifiers,
): SetDraft {
  return { ...draft, set: withSlotLabels(draft.set, index, labels) };
}

/** The draft's copies as loadouts, so they read like any other until Save stores them. */
export function draftLoadouts(copies: SetDraft["copies"]): SavedLoadout[] {
  return Object.entries(copies).map(([id, data]) => transientLoadout(id, data));
}

/** The copies Save has to store, in slot order. */
export function pendingCopies(draft: SetDraft): { id: string; data: SavedLoadoutData }[] {
  return draft.set.slots.flatMap(({ loadoutId }) => {
    const data = draft.copies[loadoutId];
    return data ? [{ id: loadoutId, data }] : [];
  });
}

/** The set to save, its temporary ids swapped for the stored copies' real ones. */
export function savedSetFromDraft(
  draft: SetDraft,
  name: string,
  storedIds: ReadonlyMap<string, string>,
): ActivitySet {
  return {
    ...draft.set,
    name,
    slots: draft.set.slots.map((s) => ({
      ...s,
      loadoutId: storedIds.get(s.loadoutId) ?? s.loadoutId,
    })),
  };
}

/** What the bottom of an open set's card shows. */
export type SetFooterStatus =
  | { kind: "running"; stopping: boolean; position: number; total: number }
  | { kind: "unsaved"; isNew: boolean; saving: boolean; canSave: boolean; message: string }
  | { kind: "saved"; canApply: boolean }
  /** Its character has left the account, so there's nothing to do with it. */
  | { kind: "unavailable" };

export function setFooterStatus({
  set,
  isNew,
  dirty,
  saving,
  hasCharacter,
  run,
  canRun,
}: {
  /** The working copy; its name may still be blank. */
  set: ActivitySet;
  /** Never saved yet. */
  isNew: boolean;
  /** An existing set with edits not saved yet. */
  dirty: boolean;
  saving: boolean;
  hasCharacter: boolean;
  /** The run in progress, whichever set it's for. */
  run: ActivitySetRunState | null;
  /** False while gear is still provisional or the loadouts aren't in. */
  canRun: boolean;
}): SetFooterStatus {
  if (run?.setId === set.id) {
    return { kind: "running", stopping: run.stopping, position: run.position, total: run.total };
  }
  const count = set.slots.length;
  if (isNew || dirty) {
    const named = set.name.trim().length > 0;
    return {
      kind: "unsaved",
      isNew,
      saving,
      // Without a name it stays pressable: pressing it shows what's missing.
      canSave: !saving && !(named && count === 0),
      message: !named
        ? "Name this set to save it"
        : count === 0
          ? "Add a loadout to save it"
          : isNew
            ? "Not saved yet"
            : "Unsaved changes",
    };
  }
  if (!hasCharacter) return { kind: "unavailable" };
  return { kind: "saved", canApply: canRun && run === null && count > 0 };
}
