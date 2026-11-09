"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  FloppyDiskIcon,
  Loading03Icon,
  PencilEdit02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "@/lib/toast";
import type { Armory } from "@/lib/armory/fetch";
import { mostRecentCharacter } from "@/lib/armory/character-for-class";
import type { RefreshResult } from "@/lib/armory/use-armory";
import type { Manifest } from "@/lib/manifest/load";
import {
  defaultIdentifiers,
  type InGameLoadoutsResponse,
  type InGameLoadoutSlot,
  type SlotIdentifiers,
} from "@/lib/bungie/ingame-loadouts";
import {
  activitySetsForCharacter,
  loadoutClassType,
  MAX_ACTIVITY_SET_NAME_LENGTH,
  MAX_ACTIVITY_SETS,
  orphanedSetLoadouts,
  sameActivitySet,
  withSlotAssignment,
  withSlotLabels,
  type ActivitySet,
} from "@/lib/loadouts/activity-sets";
import {
  runActivitySet,
  stopActivitySet,
  useActivitySetRun,
} from "@/lib/loadouts/activity-set-run";
import { commitEditedLoadout } from "@/lib/loadouts/commit";
import { inGameImportName, inGameSlotToLoadout } from "@/lib/loadouts/ingame-import";
import {
  clearInGameSlots,
  inGameLoadoutsKey,
  relabelInGameSlot,
  saveLoadoutInGame,
  type InGameSlotChoice,
} from "@/lib/loadouts/ingame-save";
import type { ModsSection } from "@/lib/loadouts/mod-placement";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import type { SavedLoadout, SavedLoadoutData } from "@/lib/loadouts/types";
import {
  changeActivitySets,
  removeActivitySet,
  saveActivitySet,
  useActivitySets,
} from "@/lib/loadouts/use-activity-sets";
import { useInGameLoadouts } from "@/lib/loadouts/use-ingame-loadouts";
import { useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import {
  reportLoadoutError,
  useLoadoutMutations,
  useLoadouts,
  type LoadoutsApiError,
} from "@/lib/loadouts/use-loadouts";
import { CharacterEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { ActivitySetFooter, LoadoutPickList } from "@/components/loadouts/activity-set-panel";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import { InGameSaveDialog, SlotCustomizeDialog } from "@/components/loadouts/ingame-save-dialog";
import { CurrentSlotDetail, SetSlotDetail } from "@/components/loadouts/ingame-slot-detail";
import { InGameSlotGrid } from "@/components/loadouts/ingame-slot-grid";
import {
  LoadoutEditorDrawer,
  type LoadoutDetailsValues,
} from "@/components/loadouts/loadout-editor-drawer";
import {
  editorModsFor,
  useLoadoutEditorSections,
} from "@/components/loadouts/use-loadout-editor-sections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Bungie can serve the old slots for a few seconds after one changes, so a re-read right
 * after a write would put the old contents back on screen.
 */
const SLOT_REREAD_DELAY_MS = 3000;

const UNSAVED_DOT = (
  <span role="img" aria-label="Unsaved" className="bg-warning size-1.5 shrink-0 rounded-full" />
);

/**
 * One entry in the left column, in its own container. The open one holds its slot grid. A
 * closed one is clickable all over, so its hover ring goes around the container, and
 * `titleAction` and `actions` sit above that click area.
 */
function SetCard({
  open,
  onClick,
  title,
  nameField,
  titleAction,
  trailing,
  actions,
  children,
}: {
  open: boolean;
  onClick: () => void;
  title: string;
  /** Replaces the whole row while the name is being typed. */
  nameField?: ReactNode;
  titleAction?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  /** The slot grid, shown while open. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "d2-card-frame group/set relative flex shrink-0 flex-col gap-2 p-1.5 transition-[background-color,outline-offset]",
        "has-[[data-set-toggle]:focus-visible]:ring-outline-strong has-[[data-set-toggle]:focus-visible]:ring-1",
        !open && !nameField && "d2-hover-ring hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--lifted))]",
      )}
    >
      <div className="flex h-8 min-w-0 items-center gap-2 px-2 text-sm">
        {nameField ?? (
          <>
            <button
              type="button"
              aria-expanded={open}
              data-set-toggle
              onClick={onClick}
              className={cn(
                "min-w-0 text-left outline-none transition-colors",
                open
                  ? "text-foreground"
                  : "text-muted-foreground group-hover/set:text-foreground cursor-pointer after:absolute after:inset-0",
              )}
            >
              <span className="block truncate">{title}</span>
            </button>
            {titleAction && <div className="relative z-10 flex shrink-0">{titleAction}</div>}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {trailing}
              {actions && <div className="relative z-10 flex">{actions}</div>}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                className={cn("text-muted-foreground size-3 shrink-0 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </div>
          </>
        )}
      </div>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

/** A small icon button in a set's row. */
function SetRowAction({
  tooltip,
  label,
  icon,
  iconClassName,
  onClick,
  disabled,
}: {
  tooltip: string;
  label: string;
  icon: IconSvgElement;
  iconClassName?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <TooltipLabel label={tooltip}>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-6 shrink-0"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        <HugeiconsIcon icon={icon} className={cn("size-3.5", iconClassName)} aria-hidden />
      </Button>
    </TooltipLabel>
  );
}

/** Renames a saved set where it's listed. Enter or clicking away keeps it; Escape doesn't. */
function SetRenameInput({
  name,
  onDone,
}: {
  name: string;
  /** The new name, or null if it wasn't changed. */
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(name);
  const cancelled = useRef(false);
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(cancelled.current ? null : value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        cancelled.current = e.key === "Escape";
        e.currentTarget.blur();
      }}
      maxLength={MAX_ACTIVITY_SET_NAME_LENGTH}
      aria-label="Set name"
      autoFocus
      className="min-w-0 flex-1"
    />
  );
}

type Pane = { kind: "current" } | { kind: "set"; id: string };

/**
 * The open set while it's being edited. Nothing is stored until Save. `copies` holds the
 * in-game slots copied into it so far, by the temporary loadout id its slots use for them.
 */
interface SetDraft {
  set: ActivitySet;
  copies: Readonly<Record<string, SavedLoadoutData>>;
}

// Kept outside the component, so unsaved work survives flipping to Conflux and back.
let stashedDraft: { draft: SetDraft; characterId: string } | null = null;

type SlotDialog =
  | { kind: "none" }
  | { kind: "pick"; slot: InGameLoadoutSlot }
  | { kind: "save"; slot: InGameLoadoutSlot; saved: SavedLoadout }
  | { kind: "delete"; slot: InGameLoadoutSlot }
  | { kind: "customize"; slot: InGameLoadoutSlot }
  | { kind: "customize-set-slot"; slot: InGameLoadoutSlot }
  | { kind: "delete-set"; set: ActivitySet };

/** Where an edit from the drawer gets saved. */
type EditTarget = "slot" | "conflux" | "both";

/** What the editor drawer has open: a saved loadout, or a slot's gear not saved anywhere yet. */
interface Editing {
  key: string;
  data: SavedLoadoutData;
  savedId?: string;
  /** A copy only the draft holds so far. */
  copyId?: string;
  /** A Conflux loadout opened from this slot of the set, so the edit can stay in the slot. */
  setSlotIndex?: number;
  /** A slot's gear on its way to being a new Conflux loadout. */
  toConflux?: boolean;
  slot?: InGameLoadoutSlot;
  mods?: ModsSection;
}

/**
 * The In-game tab of the loadouts page. Per character: what's in each in-game slot right
 * now, and the activity sets (saved loadouts assigned to slots) built on this screen.
 */
export function InGameLoadoutsView({
  armory,
  provisional,
  manifest,
  onArmoryChanged,
  refreshArmory,
}: {
  armory: Armory;
  provisional: boolean;
  manifest: Manifest;
  onArmoryChanged: () => void;
  refreshArmory: () => Promise<RefreshResult>;
}) {
  const queryClient = useQueryClient();
  const loadouts = useLoadouts();
  const { create, update, remove } = useLoadoutMutations();
  const allSets = useActivitySets();
  const setRun = useActivitySetRun();

  // Only a draft for a character on this account (the player may have signed in as another).
  const [restored] = useState(() =>
    armory.characters.some((c) => c.id === stashedDraft?.characterId) ? stashedDraft : null,
  );
  const [characterId, setCharacterId] = useState(
    () => restored?.characterId ?? mostRecentCharacter(armory.characters)?.id,
  );
  const character = armory.characters.find((c) => c.id === characterId);
  const [pane, setPane] = useState<Pane>(
    restored ? { kind: "set", id: restored.draft.set.id } : { kind: "current" },
  );
  const [draft, setDraft] = useState<SetDraft | null>(restored?.draft ?? null);
  const [savingSet, setSavingSet] = useState(false);
  // Save was pressed on a new set with no name, so its name field shows red.
  const [nameMissing, setNameMissing] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [renamingId, setRenamingId] = useState<string>();
  // Where the player was heading when asked about discarding unsaved changes.
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [saveAttention, setSaveAttention] = useState(0);
  const [peek, setPeek] = useState(false);
  // The slot the player clicked; until then a sensible default (see `selectedSlot`).
  const [pickedSlot, setPickedSlot] = useState<number>();
  const selectPane = (next: Pane) => {
    setPane(next);
    setPickedSlot(undefined);
  };
  const [dialog, setDialog] = useState<SlotDialog>({ kind: "none" });
  const [editing, setEditing] = useState<Editing | null>(null);
  // Which of the drawer's saves is in flight, for its spinner.
  const [savingFor, setSavingFor] = useState<EditTarget>();
  const [applying, setApplying] = useState(false);

  const slotsQuery = useInGameLoadouts(character?.id, true);
  const { data: inGame, error, isFetching, refetch } = slotsQuery;
  const slots = useMemo(() => inGame?.slots ?? [], [inGame]);
  const filled = useMemo(() => slots.filter((s) => !s.empty), [slots]);

  const all = useMemo(() => loadouts.data ?? [], [loadouts.data]);
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
  const drafting = pane.kind === "set" && draft?.set.id === pane.id;
  const activeSet = drafting ? draft.set : savedActive;
  const isNewSet = drafting && !savedActive;
  const setDirty = drafting && !!savedActive && !sameActivitySet(draft.set, savedActive);
  const unsaved = isNewSet || setDirty;
  // The draft's copies read like any other loadout until Save stores them.
  const setLoadouts = drafting
    ? [
        ...all,
        ...Object.entries(draft.copies).map(([id, data]) => ({
          ...data,
          id,
          createdAt: 0,
          updatedAt: 0,
        })),
      ]
    : all;
  const activeSetCharacter = activeSet
    ? armory.characters.find((c) => c.id === activeSet.characterId)
    : undefined;
  const selectedSlot =
    slots.find((s) => s.index === pickedSlot) ??
    (activeSet
      ? slots.find((s) => activeSet.slots.some((a) => a.index === s.index))
      : filled[0]) ??
    slots[0];

  // A set whose character is gone can be opened from any tab, so its class decides.
  const optionClass = activeSet?.classType ?? character?.classType;
  const options = all
    .filter((l) => !l.setOnly && loadoutClassType(l, pieceMap) === optionClass)
    .sort((a, b) => a.loadout.name.localeCompare(b.loadout.name));
  // What the grid says about each slot of the open set.
  const assignments =
    activeSet &&
    new Map(
      activeSet.slots.map((s) => [
        s.index,
        setLoadouts.find((l) => l.id === s.loadoutId)?.loadout.name ?? null,
      ]),
    );
  const busy = provisional || applying || setRun !== null;

  const rereadSlots = (id: string) =>
    window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: inGameLoadoutsKey(id) }),
      SLOT_REREAD_DELAY_MS,
    );

  useEffect(() => {
    stashedDraft = draft && characterId ? { draft, characterId } : null;
  }, [draft, characterId]);

  const askToLeave = useCallback((go: () => void) => setLeaving(() => go), []);
  useUnsavedChangesGuard(unsaved, askToLeave);

  /** The player chose not to leave: point at what still needs doing. */
  const stayOnSet = () => {
    setLeaving(null);
    setSaveAttention((n) => n + 1);
    if (isNewSet && !draft.set.name.trim()) setNameMissing(true);
  };

  /** Drop the draft, and any copy an interrupted save stored for it that no set uses. */
  const discardDraft = () => {
    if (draft) orphanedSetLoadouts([draft.set], allSets, all).forEach((id) => remove.mutate(id));
    setDraft(null);
  };

  /** Move away from the open set, asking first if that would lose unsaved work. */
  const leaveSet = (go: () => void) => {
    if (unsaved) {
      setLeaving(() => go);
      return;
    }
    setDraft(null);
    go();
  };

  const selectCharacter = (next: string) =>
    leaveSet(() => {
      setCharacterId(next);
      // Sets and slots belong to a character.
      selectPane({ kind: "current" });
    });

  const openPane = (next: Pane) => {
    const same = next.kind === "set" ? pane.kind === "set" && pane.id === next.id : pane.kind === "current";
    if (!same) leaveSet(() => selectPane(next));
  };

  const newSet = () => {
    if (!character) return;
    const { id: characterIdForSet, classType } = character;
    leaveSet(() => {
      const set: ActivitySet = {
        id: crypto.randomUUID(),
        name: "",
        characterId: characterIdForSet,
        classType,
        slots: [],
      };
      setDraft({ set, copies: {} });
      setNameMissing(false);
      selectPane({ kind: "set", id: set.id });
    });
  };

  /** Renaming a saved set takes effect at once, without touching any other unsaved edits. */
  const renameSet = (saved: ActivitySet, name: string) => {
    saveActivitySet({ ...saved, name });
    if (draft?.set.id === saved.id) setDraft({ ...draft, set: { ...draft.set, name } });
  };

  const deleteSet = (set: ActivitySet) => {
    setDialog({ kind: "none" });
    if (set.id === activeSet?.id) {
      discardDraft();
      selectPane({ kind: "current" });
    }
    changeSets(() => removeActivitySet(set.id));
    toast.success("Activity set deleted");
  };

  /** Apply a change to the open set's working copy, starting one if needed. */
  const editDraft = (change: (current: SetDraft) => SetDraft) => {
    if (!activeSet) return;
    setDraft(change(drafting ? draft : { set: activeSet, copies: {} }));
  };
  const assignSlot = (index: number, loadoutId: string | undefined) =>
    editDraft((d) => ({ ...d, set: withSlotAssignment(d.set, index, loadoutId) }));

  /**
   * Open a new, unsaved set holding every filled slot, each as a private copy that stays
   * out of the Conflux list. The player trims it and names it; Save stores it.
   */
  const startSetFromSlots = () => {
    if (!character || !inGame) return;
    const copies: Record<string, SavedLoadoutData> = {};
    const assigned = filled.map((slot) => {
      const id = crypto.randomUUID();
      copies[id] = {
        ...slotToLoadout(slot, inGameImportName(slot, inGame.identifiers.names)),
        setOnly: true,
      };
      return {
        index: slot.index,
        loadoutId: id,
        labels: defaultIdentifiers(slot, inGame.identifiers),
      };
    });
    const set: ActivitySet = {
      id: crypto.randomUUID(),
      name: "",
      characterId: character.id,
      classType: character.classType,
      slots: assigned,
    };
    setDraft({ set, copies });
    selectPane({ kind: "set", id: set.id });
  };

  /** Take a slot out of the open set, or put what the game holds there into it. */
  const toggleSlot = (slot: InGameLoadoutSlot) => {
    if (activeSet?.slots.some((s) => s.index === slot.index)) assignSlot(slot.index, undefined);
    else copySlotIntoSet(slot);
  };

  /**
   * Add a copy of what's in a slot to the draft, with its name, icon and colour, so a
   * later set can't change how this one comes back. It's stored when the set is saved.
   */
  const copySlotIntoSet = (slot: InGameLoadoutSlot) => {
    if (!character || !inGame) return;
    const id = crypto.randomUUID();
    const labels = defaultIdentifiers(slot, inGame.identifiers);
    const data: SavedLoadoutData = {
      ...slotToLoadout(slot, inGameImportName(slot, inGame.identifiers.names)),
      setOnly: true,
    };
    editDraft((d) => {
      const set = withSlotAssignment(d.set, slot.index, id);
      return {
        set: labels ? withSlotLabels(set, slot.index, labels) : set,
        copies: { ...d.copies, [id]: data },
      };
    });
  };

  /** Store the draft: its copies first, then the set that points at them. */
  const saveDraft = async () => {
    if (!draft || savingSet) return;
    const name = draft.set.name.trim();
    if (!name) {
      setNameMissing(true);
      nameInputRef.current?.focus();
      return;
    }
    if (draft.set.slots.length === 0) return;
    setSavingSet(true);
    let slots = draft.set.slots;
    const copies = { ...draft.copies };
    for (const { loadoutId } of draft.set.slots) {
      const copy = copies[loadoutId];
      if (!copy) continue;
      try {
        const stored = await create.mutateAsync(copy);
        slots = slots.map((s) => (s.loadoutId === loadoutId ? { ...s, loadoutId: stored.id } : s));
        delete copies[loadoutId];
      } catch (err) {
        // Keep what landed, so trying again doesn't store those copies twice.
        setDraft({ set: { ...draft.set, slots }, copies });
        setSavingSet(false);
        reportLoadoutError(toast)(err as LoadoutsApiError);
        return;
      }
    }
    changeSets(() => saveActivitySet({ ...draft.set, name, slots }));
    setDraft(null);
    setSavingSet(false);
    toast.success(`${name} saved`);
  };

  const runSet = (set: ActivitySet) =>
    void runActivitySet({
      set,
      loadouts: all,
      armory,
      refreshArmory,
      manifest,
      queryClient,
    }).finally(() => rereadSlots(set.characterId));

  /** Change the sets, then delete any private copy that no set uses any more. */
  const changeSets = (change: () => void) =>
    changeActivitySets(change, all, (id) => remove.mutate(id));

  const slotToLoadout = (slot: InGameLoadoutSlot, name: string) =>
    inGameSlotToLoadout({
      slot,
      name,
      classType: character!.classType,
      pieceMap,
      weaponMap,
      manifest,
    });

  /** Equip a saved loadout and save it into a slot (see saveLoadoutInGame). */
  const saveToSlot = async (saved: SavedLoadout, choice: InGameSlotChoice) => {
    if (!character || busy) return;
    const resolved = resolveLoadout(saved.loadout, pieceMap, manifest, weaponMap);
    if (!resolved.actionable) {
      toast.warning(
        "Not saved in-game",
        `${saved.loadout.name} has armor that isn't in your inventory`,
      );
      return;
    }
    setApplying(true);
    try {
      const outcome = await saveLoadoutInGame({
        saved,
        resolved,
        character,
        armory: armory.pieces,
        weapons: armory.weapons,
        manifest,
        queryClient,
        choice,
      });
      if (outcome) onArmoryChanged();
    } catch {
      toast.error("Apply failed — check your connection and try again");
    } finally {
      setApplying(false);
    }
    rereadSlots(character.id);
  };

  /** Open a slot's gear in the drawer, to adjust and name before it's saved to Conflux. */
  const copySlot = (slot: InGameLoadoutSlot) => {
    if (!character || !inGame) return;
    const data = slotToLoadout(slot, inGameImportName(slot, inGame.identifiers.names));
    setEditing({
      key: `copy-slot-${slot.index}`,
      data,
      toConflux: true,
      mods: editorModsFor(data, pieceMap, weaponMap, manifest, armory.insertablePlugs),
    });
  };

  const customizeSlot = async (slot: InGameLoadoutSlot, labels: SlotIdentifiers) => {
    if (!character) return;
    setDialog({ kind: "none" });
    const pending = toast.loading(`Updating slot ${slot.index + 1}`);
    const result = await relabelInGameSlot({
      characterId: character.id,
      choice: { loadoutIndex: slot.index, ...labels },
      queryClient,
    });
    if (result.ok) {
      pending.success(`Slot ${slot.index + 1} updated`);
      rereadSlots(character.id);
    } else {
      pending.error(`Couldn't update slot ${slot.index + 1}`, result.error);
    }
  };

  const deleteSlot = async (slot: InGameLoadoutSlot) => {
    if (!character || !inGame) return;
    setDialog({ kind: "none" });
    const name = inGameImportName(slot, inGame.identifiers.names);
    const { failure } = await clearInGameSlots({
      characterId: character.id,
      indexes: [slot.index],
      queryClient,
    });
    if (failure) toast.error(`Couldn't delete ${name}`, failure.error);
    else {
      toast.success(`Deleted ${name}`);
      rereadSlots(character.id);
    }
  };

  const editSaved = (saved: SavedLoadout) => {
    const copy = drafting ? draft.copies[saved.id] : undefined;
    setEditing({
      key: saved.id,
      data: copy ?? saved,
      ...(copy ? { copyId: saved.id } : { savedId: saved.id }),
      ...(!copy && !saved.setOnly ? { setSlotIndex: selectedSlot?.index } : {}),
      mods: editorModsFor(saved, pieceMap, weaponMap, manifest, armory.insertablePlugs),
    });
  };

  const editSlot = (slot: InGameLoadoutSlot) => {
    if (!inGame) return;
    const data = slotToLoadout(slot, inGameImportName(slot, inGame.identifiers.names));
    setEditing({
      key: `slot-${slot.index}`,
      data,
      slot,
      mods: editorModsFor(data, pieceMap, weaponMap, manifest, armory.insertablePlugs),
    });
  };

  /** A saved loadout's edit updates it. A slot's goes back into the slot, or to Conflux. */
  const submitEdit = (values: LoadoutDetailsValues, target: EditTarget) => {
    if (!editing) return;
    const { savedId, copyId, setSlotIndex, slot, mods } = editing;
    const data = commitEditedLoadout(editing.data, values, manifest, mods);
    if (copyId) {
      editDraft((d) => ({ ...d, copies: { ...d.copies, [copyId]: data } }));
      setEditing(null);
      return;
    }
    // The slot gets its own copy, stored when the set is saved.
    const giveSlotOwnCopy = (index: number, copy: SavedLoadoutData) => {
      const id = crypto.randomUUID();
      editDraft((d) => ({
        set: withSlotAssignment(d.set, index, id),
        copies: { ...d.copies, [id]: { ...copy, setOnly: true } },
      }));
    };
    if (setSlotIndex !== undefined && target === "slot") {
      giveSlotOwnCopy(setSlotIndex, data);
      setEditing(null);
      return;
    }
    if (savedId) {
      // The slot points at this loadout, so updating it updates the slot too, unless
      // the slot is first handed what it held before.
      const before = editing.data;
      setSavingFor(target);
      const pending = toast.loading("Saving loadout");
      update.mutate(
        { id: savedId, data },
        {
          onSuccess: () => {
            if (setSlotIndex !== undefined && target === "conflux") {
              giveSlotOwnCopy(setSlotIndex, before);
            }
            setEditing(null);
            pending.success("Loadout updated");
          },
          onError: reportLoadoutError(pending),
        },
      );
      return;
    }
    const identifiers = slot && inGame && defaultIdentifiers(slot, inGame.identifiers);
    if (target !== "conflux" && (!slot || !identifiers)) return;
    // Equipping reads only the loadout, so nothing needs saving anywhere first.
    const updateSlot = () =>
      slot &&
      identifiers &&
      void saveToSlot(
        { ...data, id: `slot-${slot.index}`, createdAt: 0, updatedAt: 0 },
        { loadoutIndex: slot.index, ...identifiers },
      );
    if (target === "slot") {
      setEditing(null);
      updateSlot();
      return;
    }
    // The slot waits for Conflux, so a failed save leaves the game as it was.
    setSavingFor(target);
    const pending = toast.loading("Saving loadout");
    create.mutate(data, {
      onSuccess: () => {
        setEditing(null);
        pending.success("Loadout saved to Conflux");
        if (target === "both") updateSlot();
      },
      onError: reportLoadoutError(pending),
    });
  };

  const sections = useLoadoutEditorSections(editing?.data, armory, pieceMap, manifest);

  const slotsState = (
    <SlotsState
      hasCharacter={!!character}
      data={inGame}
      error={error}
      isFetching={isFetching}
      onRetry={() => void refetch()}
    />
  );

  // Drawn inside whichever entry on the left is open.
  const slotGrid =
    activeSet && !activeSetCharacter ? (
      <p className="text-muted-foreground text-sm">
        This set&apos;s character is no longer on your account, so it can&apos;t be applied to the game.
      </p>
    ) : !inGame || slots.length === 0 ? (
      slotsState
    ) : (
      <InGameSlotGrid
        slots={slots}
        identifiers={inGame.identifiers}
        selectedIndex={selectedSlot?.index}
        onSelect={setPickedSlot}
        assignments={assignments}
        labelsFor={(index) => activeSet?.slots.find((s) => s.index === index)?.labels}
        peek={peek}
        onToggleSlot={
          activeSet && activeSetCharacter && setRun?.setId !== activeSet.id && !savingSet
            ? toggleSlot
            : undefined
        }
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="max-w-2xl shrink-0">
        <CharacterEmblemTabs
          characters={armory.characters}
          value={character?.id ?? ""}
          onChange={selectCharacter}
        />
      </div>

      {/* Phones scroll the whole thing; wide screens scroll each column on its own. The
          -m-1 p-1 here and on each column leave room for hover rings, which overflow would clip. */}
      <div className="d2-scroll -m-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-1 lg:flex-row lg:overflow-hidden">
        <nav
          aria-label="Current slots and activity sets"
          className="d2-scroll flex w-full max-w-[22rem] shrink-0 flex-col gap-2 lg:-m-1 lg:w-[22rem] lg:overflow-y-auto lg:overscroll-contain lg:p-1"
        >
          <SetCard
            title="In the game now"
            open={!activeSet}
            onClick={() => openPane({ kind: "current" })}
            titleAction={
              !activeSet && (
                <SetRowAction
                  tooltip="Reload from the game"
                  label="Reload from the game"
                  icon={RefreshIcon}
                  iconClassName={cn(isFetching && "animate-spin")}
                  onClick={() => void refetch()}
                  disabled={isFetching || !character}
                />
              )
            }
          >
            <div className="flex flex-col gap-3">
              {slotGrid}
              {inGame && slots.length > 0 && (
                <Button
                  variant="emphatic"
                  className="w-full gap-1.5"
                  onClick={startSetFromSlots}
                  disabled={filled.length === 0 || allSets.length >= MAX_ACTIVITY_SETS || isFetching}
                >
                  <HugeiconsIcon icon={FloppyDiskIcon} aria-hidden />
                  Save as set
                </Button>
              )}
            </div>
          </SetCard>

          <div className="mt-2 flex shrink-0 items-center justify-between gap-2 px-1">
            <h2 className="d2-label">Activity sets</h2>
            <TooltipLabel label="New activity set">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="New activity set"
                onClick={newSet}
                disabled={!character || allSets.length >= MAX_ACTIVITY_SETS}
              >
                <HugeiconsIcon icon={Add01Icon} aria-hidden />
              </Button>
            </TooltipLabel>
          </div>

          {(isNewSet ? [...sets, draft.set] : sets).map((listed) => {
            const open = listed.id === activeSet?.id;
            const set = open ? activeSet : listed;
            const locked = setRun?.setId === set.id || savingSet;
            return (
              <SetCard
                key={set.id}
                title={set.name.trim() || "New set"}
                open={open}
                onClick={() => openPane({ kind: "set", id: set.id })}
                nameField={
                  isNewSet && listed.id === draft.set.id ? (
                    <>
                      <Input
                        ref={nameInputRef}
                        value={set.name}
                        onChange={(e) => {
                          const name = e.target.value;
                          setNameMissing(false);
                          editDraft((d) => ({ ...d, set: { ...d.set, name } }));
                        }}
                        maxLength={MAX_ACTIVITY_SET_NAME_LENGTH}
                        placeholder="Name this set"
                        aria-label="Set name"
                        aria-invalid={nameMissing || undefined}
                        required
                        autoFocus
                        disabled={savingSet}
                        className="aria-invalid:placeholder:text-destructive min-w-0 flex-1"
                      />
                      {UNSAVED_DOT}
                    </>
                  ) : renamingId === listed.id ? (
                    <SetRenameInput
                      name={listed.name}
                      onDone={(name) => {
                        setRenamingId(undefined);
                        if (name && name !== listed.name) renameSet(listed, name);
                      }}
                    />
                  ) : undefined
                }
                titleAction={
                  <SetRowAction
                    tooltip="Rename"
                    label={`Rename ${set.name}`}
                    icon={PencilEdit02Icon}
                    onClick={() => setRenamingId(listed.id)}
                    disabled={locked}
                  />
                }
                trailing={
                  setRun?.setId === set.id ? (
                    <HugeiconsIcon icon={Loading03Icon} className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  ) : open && unsaved ? (
                    UNSAVED_DOT
                  ) : (
                    <span className="text-muted-foreground text-xs tabular-nums">{set.slots.length}</span>
                  )
                }
                actions={
                  <SetRowAction
                    tooltip="Delete set"
                    label={`Delete ${set.name}`}
                    icon={Delete02Icon}
                    onClick={() => setDialog({ kind: "delete-set", set: listed })}
                    disabled={locked}
                  />
                }
              >
                <div className="flex flex-col gap-3">
                  {slotGrid}
                  <ActivitySetFooter
                    set={set}
                    isNew={isNewSet}
                    dirty={setDirty}
                    saving={savingSet}
                    hasCharacter={!!activeSetCharacter}
                    loadouts={setLoadouts}
                    run={setRun}
                    canRun={!provisional && !applying && !loadouts.isPending}
                    saveAttention={saveAttention}
                    onSaveAttentionEnd={() => setSaveAttention(0)}
                    onSave={() => void saveDraft()}
                    onDiscard={() => {
                      discardDraft();
                      if (isNewSet) selectPane({ kind: "current" });
                    }}
                    onRun={runSet}
                    onStop={stopActivitySet}
                  />
                </div>
              </SetCard>
            );
          })}
          {sets.length === 0 && !isNewSet && (
            <p className="text-muted-foreground px-1 text-xs">
              Group loadouts by activity and apply them to the game together.
            </p>
          )}
        </nav>

        <div className="d2-scroll flex min-w-0 flex-1 flex-col gap-3 lg:-m-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-1">
          <div className="min-w-0 shrink-0">
            {inGame && selectedSlot && character && (!activeSet || activeSetCharacter) &&
              (activeSet ? (
                <SetSlotDetail
                  key={`${activeSet.id}-${selectedSlot.index}`}
                  slot={selectedSlot}
                  identifiers={inGame.identifiers}
                  loadoutId={activeSet.slots.find((s) => s.index === selectedSlot.index)?.loadoutId}
                  labels={activeSet.slots.find((s) => s.index === selectedSlot.index)?.labels}
                  classType={activeSet.classType}
                  peek={peek}
                  onPeekChange={setPeek}
                  canPeek={filled.length > 0}
                  loadouts={setLoadouts}
                  options={options}
                  pieceMap={pieceMap}
                  weaponMap={weaponMap}
                  manifest={manifest}
                  disabled={setRun?.setId === activeSet.id || savingSet}
                  onAssign={(loadoutId) => assignSlot(selectedSlot.index, loadoutId)}
                  onCopySlot={() => copySlotIntoSet(selectedSlot)}
                  onCustomize={(slot) => setDialog({ kind: "customize-set-slot", slot })}
                  onEditLoadout={editSaved}
                />
              ) : (
                <CurrentSlotDetail
                  key={selectedSlot.index}
                  slot={selectedSlot}
                  identifiers={inGame.identifiers}
                  classType={character.classType}
                  pieceMap={pieceMap}
                  weaponMap={weaponMap}
                  manifest={manifest}
                  disabled={busy}
                  onEdit={() => editSlot(selectedSlot)}
                  onCustomize={() => setDialog({ kind: "customize", slot: selectedSlot })}
                  onReplace={() => setDialog({ kind: "pick", slot: selectedSlot })}
                  onCopy={() => copySlot(selectedSlot)}
                  onDelete={() => setDialog({ kind: "delete", slot: selectedSlot })}
                />
              ))}
          </div>
        </div>
      </div>

      {dialog.kind === "pick" && (
        <Dialog open onOpenChange={(open) => !open && setDialog({ kind: "none" })}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader className="pr-8">
              <DialogTitle>
                {dialog.slot.empty ? "Save a loadout to" : "Replace"} slot {dialog.slot.index + 1}
              </DialogTitle>
              <DialogDescription>
                Pick the Conflux loadout to equip and save into this slot.
              </DialogDescription>
            </DialogHeader>
            <LoadoutPickList
              options={options}
              manifest={manifest}
              listLabel={`Loadouts for slot ${dialog.slot.index + 1}`}
              onPick={(saved) => setDialog({ kind: "save", slot: dialog.slot, saved })}
            />
          </DialogContent>
        </Dialog>
      )}
      {dialog.kind === "save" && character && (
        <InGameSaveDialog
          open
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          loadoutName={dialog.saved.loadout.name}
          character={character}
          manifest={manifest}
          initialSlotIndex={dialog.slot.index}
          onConfirm={(choice) => void saveToSlot(dialog.saved, choice)}
        />
      )}
      {dialog.kind === "customize" && inGame && (
        <SlotCustomizeDialog
          slot={dialog.slot}
          identifiers={inGame.identifiers}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onConfirm={(labels) => void customizeSlot(dialog.slot, labels)}
        />
      )}
      {dialog.kind === "customize-set-slot" && inGame && (
        <SlotCustomizeDialog
          slot={dialog.slot}
          identifiers={inGame.identifiers}
          description="What this slot is called and how it looks in the game once the set is applied."
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onConfirm={(labels) => {
            setDialog({ kind: "none" });
            editDraft((d) => ({ ...d, set: withSlotLabels(d.set, dialog.slot.index, labels) }));
          }}
        />
      )}
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && stayOnSet()}
        title="Discard unsaved changes?"
        description={`Your changes to ${activeSet?.name.trim() || "this new set"} haven't been saved. Keep editing to save them, or discard them to leave.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          discardDraft();
          leaving?.();
          setLeaving(null);
        }}
      />
      <ConfirmDialog
        open={dialog.kind === "delete"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title="Delete in-game loadout?"
        description={
          dialog.kind === "delete" && inGame
            ? `${inGameImportName(dialog.slot, inGame.identifiers.names)} in slot ${dialog.slot.index + 1} will be emptied in the game. This can't be undone. Loadouts saved in Conflux stay as they are.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => dialog.kind === "delete" && void deleteSlot(dialog.slot)}
      />
      <ConfirmDialog
        open={dialog.kind === "delete-set"}
        onOpenChange={(open) => !open && setDialog({ kind: "none" })}
        title="Delete activity set?"
        description={
          dialog.kind === "delete-set"
            ? `“${dialog.set.name}” will be removed. Your loadouts and in-game slots stay as they are.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={() => dialog.kind === "delete-set" && deleteSet(dialog.set)}
      />

      <LoadoutEditorDrawer
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        formKey={editing?.key}
        title={
          editing?.slot
            ? `Edit slot ${editing.slot.index + 1}`
            : editing?.toConflux
              ? "Copy to Conflux"
              : "Edit loadout"
        }
        description={
          editing && !editing.mods
            ? "Mods can't be edited while a piece is missing from your inventory."
            : editing?.slot
              ? "Equips your changes and saves them into this slot."
              : undefined
        }
        submitLabel={
          editing?.slot || editing?.setSlotIndex !== undefined
            ? "Save to slot"
            : editing?.toConflux
              ? "Save to Conflux"
              : "Save changes"
        }
        initialName={editing?.data.loadout.name ?? ""}
        initialNotes={editing?.data.loadout.notes ?? ""}
        mods={editing?.mods}
        subclass={sections.subclass}
        weapons={sections.weapons}
        artifact={sections.artifact}
        busy={update.isPending || create.isPending}
        secondaryActions={
          editing?.slot
            ? [
                {
                  label: "Save to Conflux only",
                  onSubmit: (values) => submitEdit(values, "conflux"),
                  busy: create.isPending && savingFor === "conflux",
                },
                {
                  label: "Save to slot and Conflux",
                  onSubmit: (values) => submitEdit(values, "both"),
                  busy: create.isPending && savingFor === "both",
                },
              ]
            : editing?.setSlotIndex !== undefined
              ? [
                  {
                    label: "Save to Conflux only",
                    onSubmit: (values) => submitEdit(values, "conflux"),
                    busy: update.isPending && savingFor === "conflux",
                  },
                  {
                    label: "Save to slot and Conflux",
                    onSubmit: (values) => submitEdit(values, "both"),
                    busy: update.isPending && savingFor === "both",
                  },
                ]
              : undefined
        }
        onSubmit={(values) => submitEdit(values, editing?.toConflux ? "conflux" : "slot")}
      />
    </div>
  );
}

/** Stands in for the slots while they load, fail to, or don't exist. */
function SlotsState({
  hasCharacter,
  data,
  error,
  isFetching,
  onRetry,
}: {
  hasCharacter: boolean;
  data: InGameLoadoutsResponse | undefined;
  error: Error | null;
  isFetching: boolean;
  onRetry: () => void;
}) {
  if (!hasCharacter) {
    return (
      <p className="text-muted-foreground text-sm">
        You don&apos;t have a character on this account yet.
      </p>
    );
  }
  if (data) {
    return (
      <p className="text-muted-foreground text-sm">
        This character has no in-game loadout slots unlocked yet.
      </p>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-destructive text-sm">{error.message}</p>
        <Button size="sm" onClick={onRetry} disabled={isFetching}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground flex items-center gap-2 text-sm">
      <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
      Loading your in-game loadouts…
    </p>
  );
}
