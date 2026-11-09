"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Armory } from "@/lib/armory/fetch";
import { mostRecentCharacter } from "@/lib/armory/character-for-class";
import type { Manifest } from "@/lib/manifest/load";
import {
  defaultIdentifiers,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import {
  activitySetsForCharacter,
  loadoutClassType,
  sameActivitySet,
  type ActivitySet,
} from "@/lib/loadouts/activity-sets";
import { inGameSlotAsLoadout } from "@/lib/loadouts/ingame-import";
import {
  draftFromSlots,
  draftLoadouts,
  newSetDraft,
  pendingCopies,
  savedSetFromDraft,
  withDraftName,
  withDraftSlotLabels,
  withSlotCopy,
  withSlotLoadout,
  type SetDraft,
} from "@/lib/loadouts/set-draft";
import type { SavedLoadoutData } from "@/lib/loadouts/types";
import {
  removeActivitySet,
  saveActivitySet,
  useActivitySets,
} from "@/lib/loadouts/use-activity-sets";
import { useInGameLoadouts } from "@/lib/loadouts/use-ingame-loadouts";
import {
  reportLoadoutError,
  useLoadoutMutations,
  useLoadoutsWithSetCopies,
} from "@/lib/loadouts/use-loadouts";
import {
  changeSetDraft,
  replaceSetDraft,
  setSetDraftSaving,
  useSetDraft,
} from "@/lib/loadouts/use-set-draft";
import { useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { toast } from "@/lib/toast";

type Pane = { kind: "current" } | { kind: "set"; id: string };

/**
 * Which character and set the In-game tab has open, and the working copy of that set.
 * The components around it draw this state and call its actions.
 */
export function useSetEditor({
  armory,
  manifest,
  active,
}: {
  armory: Armory;
  manifest: Manifest;
  /** The In-game tab has been shown; until then nothing is fetched for it. */
  active: boolean;
}) {
  const loadouts = useLoadoutsWithSetCopies(active);
  const { createMany } = useLoadoutMutations();
  const allSets = useActivitySets();
  const { draft, saving } = useSetDraft();

  // A draft left behind can be picked up, if its character is on this account (the
  // player may have signed in as another).
  const [restored] = useState(() =>
    armory.characters.some((c) => c.id === draft?.set.characterId) ? draft : null,
  );
  const [characterId, setCharacterId] = useState(
    () => restored?.set.characterId ?? mostRecentCharacter(armory.characters)?.id,
  );
  const character = armory.characters.find((c) => c.id === characterId);
  const [pane, setPane] = useState<Pane>(
    restored ? { kind: "set", id: restored.set.id } : { kind: "current" },
  );
  // The slot the player clicked; until then a sensible default (see `selectedSlot`).
  const [pickedSlot, setPickedSlot] = useState<number>();
  // Save was pressed on a new set with no name, so its name field shows red.
  const [nameMissing, setNameMissing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Where the player was heading when asked about discarding unsaved changes.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [saveAttention, setSaveAttention] = useState(0);

  const slotsQuery = useInGameLoadouts(character?.id, active);
  const inGame = slotsQuery.data;
  const slots = useMemo(() => inGame?.slots ?? [], [inGame]);
  const filled = useMemo(() => slots.filter((s) => !s.empty), [slots]);

  const all = useMemo(() => loadouts.data ?? [], [loadouts.data]);
  const loadoutsLoaded = loadouts.data !== undefined;
  const pieceMap = useMemo(
    () => new Map(armory.pieces.map((p) => [p.instanceId, p])),
    [armory.pieces],
  );
  const weaponMap = useMemo(
    () => new Map((armory.weapons ?? []).map((w) => [w.instanceId, w])),
    [armory.weapons],
  );

  const accountIds = useMemo(() => armory.characters.map((c) => c.id), [armory.characters]);
  const sets = useMemo(
    () => activitySetsForCharacter(allSets, characterId, accountIds),
    [allSets, characterId, accountIds],
  );
  const savedActive = pane.kind === "set" ? allSets.find((s) => s.id === pane.id) : undefined;
  const openDraft = pane.kind === "set" && draft?.set.id === pane.id ? draft : null;
  const activeSet = openDraft?.set ?? savedActive;
  const isNewSet = !!openDraft && !savedActive;
  const setDirty = !!openDraft && !!savedActive && !sameActivitySet(openDraft.set, savedActive);
  const unsaved = isNewSet || setDirty;
  const activeSetCharacter = activeSet
    ? armory.characters.find((c) => c.id === activeSet.characterId)
    : undefined;

  const openCopies = openDraft?.copies;
  // The draft's copies read like any other loadout until Save stores them.
  const setLoadouts = useMemo(
    () => (openCopies ? [...all, ...draftLoadouts(openCopies)] : all),
    [all, openCopies],
  );

  // A set whose character is gone can be opened from any tab, so its class decides.
  const optionClass = activeSet?.classType ?? character?.classType;
  const options = useMemo(
    () =>
      all
        .filter((l) => !l.setOnly && loadoutClassType(l, pieceMap) === optionClass)
        .sort((a, b) => a.loadout.name.localeCompare(b.loadout.name)),
    [all, pieceMap, optionClass],
  );

  const selectedSlot =
    slots.find((s) => s.index === pickedSlot) ??
    (activeSet
      ? slots.find((s) => activeSet.slots.some((a) => a.index === s.index))
      : filled[0]) ??
    slots[0];

  const selectPane = (next: Pane) => {
    setPane(next);
    setPickedSlot(undefined);
  };

  const askToLeave = useCallback((go: () => void) => setLeaving(() => go), []);
  useUnsavedChangesGuard(unsaved, askToLeave);

  const dropDraft = () => {
    replaceSetDraft(null);
    setNameMissing(false);
  };

  /** Move away from the open set, asking first if that would lose unsaved work. */
  const leaveSet = (go: () => void) => {
    if (unsaved) {
      setLeaving(() => go);
      return;
    }
    dropDraft();
    go();
  };

  const startDraft = (next: SetDraft) => {
    replaceSetDraft(next);
    setNameMissing(false);
    selectPane({ kind: "set", id: next.set.id });
  };

  const editSet = (change: (current: SetDraft) => SetDraft) => {
    if (activeSet) changeSetDraft(activeSet, change);
  };

  /** A slot's gear as a loadout, read from the armory the page has now. */
  const slotData = (slot: InGameLoadoutSlot): SavedLoadoutData | undefined =>
    character && inGame
      ? inGameSlotAsLoadout(slot, inGame.identifiers.names, {
          classType: character.classType,
          pieceMap,
          weaponMap,
          manifest,
        })
      : undefined;

  const slotCopy = (slot: InGameLoadoutSlot) => {
    const data = slotData(slot);
    return (
      data && {
        index: slot.index,
        data,
        // So a later set can't change how this one comes back.
        labels: inGame && defaultIdentifiers(slot, inGame.identifiers),
      }
    );
  };

  const copySlotIntoSet = (slot: InGameLoadoutSlot) => {
    const copy = slotCopy(slot);
    if (copy) editSet((d) => withSlotCopy(d, copy));
  };

  const saveDraft = async () => {
    if (!draft || saving) return;
    const name = draft.set.name.trim();
    if (!name) {
      setNameMissing(true);
      nameInputRef.current?.focus();
      return;
    }
    if (draft.set.slots.length === 0) return;
    setSetDraftSaving(true);
    const copies = pendingCopies(draft);
    await (copies.length > 0 ? createMany.mutateAsync(copies.map((c) => c.data)) : Promise.resolve([]))
      .then((stored) => {
        const storedIds = new Map(copies.map((c, i) => [c.id, stored[i].id]));
        saveActivitySet(savedSetFromDraft(draft, name, storedIds));
        replaceSetDraft(null);
        toast.success(`${name} saved`);
      })
      .catch(reportLoadoutError(toast));
    setSetDraftSaving(false);
  };

  return {
    character,
    selectedSlot,
    selectSlot: setPickedSlot,
    slotsQuery,
    inGame,
    slots,
    filled,
    all,
    loadoutsLoaded,
    pieceMap,
    weaponMap,
    sets,
    allSets,
    activeSet,
    activeSetCharacter,
    /** The new, unsaved set, listed after the saved ones. */
    newSet: isNewSet ? openDraft.set : undefined,
    setDirty,
    unsaved,
    saving,
    setLoadouts,
    options,
    nameMissing,
    nameInputRef,
    saveAttention,
    leaving,
    slotData,

    selectCharacter: (next: string) =>
      leaveSet(() => {
        setCharacterId(next);
        // Sets and slots belong to a character.
        selectPane({ kind: "current" });
      }),

    openCurrent: () => {
      if (pane.kind !== "current") leaveSet(() => selectPane({ kind: "current" }));
    },

    openSet: (id: string) => {
      if (pane.kind !== "set" || pane.id !== id) leaveSet(() => selectPane({ kind: "set", id }));
    },

    startNewSet: () => {
      if (!character) return;
      const { id, classType } = character;
      leaveSet(() => startDraft(newSetDraft(id, classType)));
    },

    /** Open a new, unsaved set holding a private copy of every filled slot. */
    startSetFromSlots: () => {
      if (!character) return;
      const copies = filled.flatMap((slot) => slotCopy(slot) ?? []);
      startDraft(draftFromSlots(character.id, character.classType, copies));
    },

    typeDraftName: (name: string) => {
      setNameMissing(false);
      editSet((d) => withDraftName(d, name));
    },

    /** Renaming a saved set takes effect at once, without touching any other unsaved edits. */
    renameSet: (saved: ActivitySet, name: string) => {
      saveActivitySet({ ...saved, name });
      if (draft?.set.id === saved.id) changeSetDraft(saved, (d) => withDraftName(d, name));
    },

    /** Give a set whose character has left the account to this one, of the same class. */
    moveSetTo: (set: ActivitySet, characterId: string) => {
      const saved = allSets.find((s) => s.id === set.id);
      if (saved) saveActivitySet({ ...saved, characterId });
      if (draft?.set.id === set.id) {
        changeSetDraft(set, (d) => ({ ...d, set: { ...d.set, characterId } }));
      }
    },

    deleteSet: (set: ActivitySet) => {
      if (set.id === activeSet?.id) {
        dropDraft();
        selectPane({ kind: "current" });
      }
      removeActivitySet(set.id);
      toast.success("Activity set deleted");
    },

    assignSlot: (index: number, loadoutId: string | undefined) =>
      editSet((d) => withSlotLoadout(d, index, loadoutId)),

    labelSlot: (index: number, labels: SlotIdentifiers) =>
      editSet((d) => withDraftSlotLabels(d, index, labels)),

    copySlotIntoSet,

    /** Take a slot out of the open set, or put what the game holds there into it. */
    toggleSlot: (slot: InGameLoadoutSlot) => {
      if (activeSet?.slots.some((s) => s.index === slot.index)) {
        editSet((d) => withSlotLoadout(d, slot.index, undefined));
      } else {
        copySlotIntoSet(slot);
      }
    },

    /** Give a slot of the open set its own copy; stored when the set is saved. */
    giveSlotOwnCopy: (index: number, data: SavedLoadoutData) =>
      editSet((d) => withSlotCopy(d, { index, data })),

    /** Whether this loadout exists only in the open set's draft, or only for sets. */
    isPrivateCopy: (id: string) =>
      !!openCopies?.[id] || all.some((l) => l.id === id && l.setOnly === true),

    saveDraft,

    discardDraft: () => {
      const wasNew = isNewSet;
      dropDraft();
      if (wasNew) selectPane({ kind: "current" });
    },

    confirmLeave: () => {
      dropDraft();
      leaving?.();
      setLeaving(null);
    },

    /** The player chose not to leave: point at what still needs doing. */
    stayOnSet: () => {
      setLeaving(null);
      setSaveAttention((n) => n + 1);
      if (isNewSet && !openDraft.set.name.trim()) setNameMissing(true);
    },

    clearSaveAttention: () => setSaveAttention(0),
  };
}

export type SetEditor = ReturnType<typeof useSetEditor>;
