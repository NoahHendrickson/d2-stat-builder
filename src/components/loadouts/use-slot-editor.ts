"use client";

import { useState } from "react";
import type { Armory } from "@/lib/armory/fetch";
import type { Manifest } from "@/lib/manifest/load";
import {
  defaultIdentifiers,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import { commitEditedLoadout } from "@/lib/loadouts/commit";
import type { InGameSlotChoice } from "@/lib/loadouts/ingame-save";
import type { ModsSection } from "@/lib/loadouts/mod-placement";
import {
  transientLoadout,
  type SavedLoadout,
  type SavedLoadoutData,
} from "@/lib/loadouts/types";
import { reportLoadoutError, useLoadoutMutations } from "@/lib/loadouts/use-loadouts";
import { toast } from "@/lib/toast";
import type { LoadoutDetailsValues } from "@/components/loadouts/loadout-editor-drawer";
import {
  editorModsFor,
  useLoadoutEditorSections,
} from "@/components/loadouts/use-loadout-editor-sections";
import type { SetEditor } from "@/components/loadouts/use-set-editor";

/** Where an edit in the drawer gets saved. */
type EditTarget = "slot" | "conflux" | "both";

interface EditingBase {
  key: string;
  data: SavedLoadoutData;
  mods?: ModsSection;
}

/** What the editor drawer has open. */
type Editing = EditingBase &
  (
    | /** A private copy in the open set: its edit stays in the draft until Save. */
      { kind: "private-copy"; slotIndex: number }
    | /** A Conflux loadout opened from a slot of the open set. */
      { kind: "set-slot"; slotIndex: number; savedId: string }
    | /** What the game holds in a slot. */
      { kind: "slot"; slotIndex: number; labels: SlotIdentifiers }
    | /** What the game holds in a slot, on its way to being a new Conflux loadout. */
      { kind: "to-conflux" }
  );

interface DrawerMode {
  title: string;
  description?: string;
  submitLabel: string;
  main: EditTarget;
  others: readonly { label: string; target: EditTarget }[];
}

const SLOT_AND_CONFLUX_TARGETS = [
  { label: "Save to Conflux only", target: "conflux" },
  { label: "Save to slot and Conflux", target: "both" },
] as const;

function drawerMode(editing: Editing): DrawerMode {
  switch (editing.kind) {
    case "private-copy":
      return { title: "Edit loadout", submitLabel: "Save changes", main: "slot", others: [] };
    case "set-slot":
      return {
        title: "Edit loadout",
        submitLabel: "Save to slot",
        main: "slot",
        others: SLOT_AND_CONFLUX_TARGETS,
      };
    case "slot":
      return {
        title: `Edit slot ${editing.slotIndex + 1}`,
        description: "Equips your changes and saves them into this slot.",
        submitLabel: "Save to slot",
        main: "slot",
        others: SLOT_AND_CONFLUX_TARGETS,
      };
    case "to-conflux":
      return { title: "Copy to Conflux", submitLabel: "Save to Conflux", main: "conflux", others: [] };
  }
}

/** The editor drawer on the In-game tab: what it has open, and where each save goes. */
export function useSlotEditor({
  sets,
  armory,
  manifest,
  saveToSlot,
}: {
  sets: SetEditor;
  armory: Armory;
  manifest: Manifest;
  saveToSlot: (saved: SavedLoadout, choice: InGameSlotChoice) => Promise<void>;
}) {
  const { create, update } = useLoadoutMutations();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Which save is in flight. The drawer can't be closed until it lands, so its result
  // can't arrive after the player has moved on.
  const [saving, setSaving] = useState<EditTarget | null>(null);
  const { pieceMap, weaponMap, inGame, selectedSlot } = sets;
  const sections = useLoadoutEditorSections(editing?.data, armory, pieceMap, manifest);

  const modsFor = (data: SavedLoadoutData) =>
    editorModsFor(data, pieceMap, weaponMap, manifest, armory.insertablePlugs);

  const callbacks = (target: EditTarget) => {
    setSaving(target);
    return {
      pending: toast.loading("Saving loadout"),
      onSettled: () => setSaving(null),
    };
  };

  const createLoadout = (data: SavedLoadoutData, target: EditTarget, then?: () => void) => {
    const { pending, onSettled } = callbacks(target);
    create.mutate(data, {
      onSuccess: () => {
        setEditing(null);
        pending.success("Loadout saved to Conflux");
        then?.();
      },
      onError: reportLoadoutError(pending),
      onSettled,
    });
  };

  const updateLoadout = (
    id: string,
    data: SavedLoadoutData,
    target: EditTarget,
    then?: () => void,
  ) => {
    const { pending, onSettled } = callbacks(target);
    update.mutate(
      { id, data },
      {
        onSuccess: () => {
          then?.();
          setEditing(null);
          pending.success("Loadout updated");
        },
        onError: reportLoadoutError(pending),
        onSettled,
      },
    );
  };

  const submit = (values: LoadoutDetailsValues, target: EditTarget) => {
    if (!editing) return;
    const data = commitEditedLoadout(editing.data, values, manifest, editing.mods);
    switch (editing.kind) {
      case "private-copy":
        sets.giveSlotOwnCopy(editing.slotIndex, data);
        setEditing(null);
        return;
      case "to-conflux":
        createLoadout(data, target);
        return;
      case "set-slot": {
        const { slotIndex, savedId, data: before } = editing;
        if (target === "slot") {
          sets.giveSlotOwnCopy(slotIndex, data);
          setEditing(null);
          return;
        }
        // The slot points at this loadout, so updating it updates the slot too, unless
        // the slot is handed what it held before.
        updateLoadout(savedId, data, target, () => {
          if (target === "conflux") sets.giveSlotOwnCopy(slotIndex, before);
        });
        return;
      }
      case "slot": {
        const { slotIndex, labels } = editing;
        // Equipping reads only the loadout, so nothing needs saving anywhere first.
        const writeSlot = () =>
          void saveToSlot(transientLoadout(`slot-${slotIndex}`, data), {
            loadoutIndex: slotIndex,
            ...labels,
          });
        if (target === "slot") {
          setEditing(null);
          writeSlot();
          return;
        }
        // The slot waits for Conflux, so a failed save leaves the game as it was.
        createLoadout(data, target, target === "both" ? writeSlot : undefined);
        return;
      }
    }
  };

  const mode = editing && drawerMode(editing);

  return {
    /** Edit what the game holds in a slot. */
    editSlot: (slot: InGameLoadoutSlot) => {
      const data = sets.slotData(slot);
      const labels = inGame && defaultIdentifiers(slot, inGame.identifiers);
      if (!data || !labels) {
        toast.warning("This slot can't be edited right now");
        return;
      }
      setEditing({
        kind: "slot",
        key: `slot-${slot.index}`,
        slotIndex: slot.index,
        labels,
        data,
        mods: modsFor(data),
      });
    },

    /** Open a slot's gear in the drawer, to adjust and name before it's saved to Conflux. */
    copySlot: (slot: InGameLoadoutSlot) => {
      const data = sets.slotData(slot);
      if (data) {
        setEditing({
          kind: "to-conflux",
          key: `copy-slot-${slot.index}`,
          data,
          mods: modsFor(data),
        });
      }
    },

    /** Edit the loadout assigned to the selected slot of the open set. */
    editSetLoadout: (saved: SavedLoadout) => {
      if (!selectedSlot) return;
      const common = {
        key: saved.id,
        slotIndex: selectedSlot.index,
        data: saved,
        mods: modsFor(saved),
      };
      setEditing(
        sets.isPrivateCopy(saved.id)
          ? { kind: "private-copy", ...common }
          : { kind: "set-slot", savedId: saved.id, ...common },
      );
    },

    drawer: {
      open: editing !== null,
      onOpenChange: (open: boolean) => {
        if (!open && saving === null) setEditing(null);
      },
      formKey: editing?.key,
      title: mode?.title ?? "Edit loadout",
      description:
        editing && !editing.mods
          ? "Mods can't be edited while a piece is missing from your inventory."
          : mode?.description,
      submitLabel: mode?.submitLabel ?? "Save changes",
      initialName: editing?.data.loadout.name ?? "",
      initialNotes: editing?.data.loadout.notes ?? "",
      mods: editing?.mods,
      subclass: sections.subclass,
      weapons: sections.weapons,
      artifact: sections.artifact,
      busy: saving !== null,
      secondaryActions:
        mode && mode.others.length > 0
          ? mode.others.map(({ label, target }) => ({
              label,
              onSubmit: (values: LoadoutDetailsValues) => submit(values, target),
              busy: saving === target,
            }))
          : undefined,
      onSubmit: (values: LoadoutDetailsValues) => {
        if (mode) submit(values, mode.main);
      },
    },
  };
}
