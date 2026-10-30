"use client";

import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import type { ArmoryCharacter } from "@/lib/armory/fetch";
import { mostRecentCharacter } from "@/lib/armory/character-for-class";
import type { InGameLoadoutIdentifiers, InGameLoadoutSlot } from "@/lib/bungie/ingame-loadouts";
import type { Manifest } from "@/lib/manifest/load";
import { useInGameLoadouts } from "@/lib/loadouts/use-ingame-loadouts";
import { CharacterEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { Emblem, SlotContents } from "@/components/loadouts/ingame-save-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Pick a character, then tick some of its filled in-game slots. The state behind
 * InGameSlotPicker; the dialog that owns it reads `character`, `query.data` and `chosen`
 * to run its action. `onCharacterChange` clears anything else the dialog keeps per slot.
 */
export function useInGameSlotPicker(
  characters: ArmoryCharacter[],
  open: boolean,
  onCharacterChange?: () => void,
) {
  // In-game loadouts belong to a character, not a class: two Hunters are two choices.
  const [characterId, setCharacterId] = useState(() => mostRecentCharacter(characters)?.id);
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const character = characters.find((c) => c.id === characterId);
  const query = useInGameLoadouts(character?.id, open);

  const filled = (query.data?.slots ?? []).filter((s) => !s.empty);
  const chosen = filled.filter((s) => picked.has(s.index));

  const selectCharacter = (next: string) => {
    if (next === characterId) return;
    setCharacterId(next);
    // Slot numbers belong to a character: picks don't carry over.
    setPicked(new Set());
    onCharacterChange?.();
  };
  const setPick = (index: number, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  const setAll = (on: boolean) => setPicked(on ? new Set(filled.map((s) => s.index)) : new Set());

  return { characters, character, selectCharacter, query, filled, chosen, picked, setPick, setAll };
}

export type InGameSlotPickerState = ReturnType<typeof useInGameSlotPicker>;

/**
 * One filled slot: a checkbox and the slot's emblem, then whatever the dialog adds
 * (`label` inside the clickable area, `children` after it), then the gear it holds.
 */
export function InGameSlotRow({
  slot,
  identifiers,
  manifest,
  picked,
  onPick,
  disabled = false,
  checkboxLabel,
  pickedClassName = "bg-foreground/8",
  label,
  children,
}: {
  slot: InGameLoadoutSlot;
  identifiers: InGameLoadoutIdentifiers;
  manifest: Manifest;
  picked: boolean;
  onPick: (picked: boolean) => void;
  disabled?: boolean;
  /** Needed when there's no `label` to name the checkbox. */
  checkboxLabel?: string;
  pickedClassName?: string;
  label?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 p-2 transition-colors",
        picked ? pickedClassName : "hover:bg-foreground/4",
      )}
    >
      <label
        className={cn(
          "flex shrink-0 cursor-pointer items-center gap-3",
          label && "min-w-40 flex-1 basis-40",
        )}
      >
        <Checkbox
          size="lg"
          checked={picked}
          disabled={disabled}
          onCheckedChange={(checked) => onPick(checked === true)}
          aria-label={checkboxLabel}
        />
        <span aria-hidden className="relative size-10 shrink-0 overflow-hidden">
          <Emblem
            identifiers={identifiers}
            iconHash={slot.iconHash}
            colorHash={slot.colorHash}
            size={40}
          />
        </span>
        {label}
      </label>
      {children}
      <SlotContents slot={slot} manifest={manifest} size={32} countMissing />
    </li>
  );
}

/**
 * The body of the in-game slot dialogs (import, delete): character tabs, then that
 * character's filled slots with Select all, or the loading / error / empty state.
 * `renderRow` draws each slot, usually as an InGameSlotRow. `disabled` locks the
 * character and the picks while the dialog acts on them.
 */
export function InGameSlotPicker({
  picker,
  disabled = false,
  renderRow,
}: {
  picker: InGameSlotPickerState;
  disabled?: boolean;
  renderRow: (slot: InGameLoadoutSlot, identifiers: InGameLoadoutIdentifiers) => ReactNode;
}) {
  const { characters, character, selectCharacter, query, filled, chosen, setAll } = picker;
  const { data, error, isFetching, refetch } = query;
  const allPicked = filled.length > 0 && chosen.length === filled.length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="d2-label">Character</h3>
        <CharacterEmblemTabs
          characters={characters}
          value={character?.id ?? ""}
          onChange={selectCharacter}
          disabled={disabled}
        />
      </section>

      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-3">
          <h3 className="d2-label">In-game loadouts</h3>
          {filled.length > 1 && (
            <label className="text-muted-foreground ml-auto flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={allPicked}
                disabled={disabled}
                onCheckedChange={(checked) => setAll(checked === true)}
              />
              Select all
            </label>
          )}
        </div>
        {!character ? (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have a character on this account yet.
          </p>
        ) : !data ? (
          error ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-destructive text-sm">{error.message}</p>
              <Button size="sm" onClick={() => void refetch()} disabled={isFetching}>
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
              Loading your in-game loadouts…
            </p>
          )
        ) : filled.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This character has nothing saved in its in-game loadouts yet.
          </p>
        ) : (
          <ul className="d2-scroll -mx-2 flex max-h-[55vh] flex-col gap-1 overflow-y-auto">
            {filled.map((slot) => renderRow(slot, data.identifiers))}
          </ul>
        )}
      </section>
    </div>
  );
}
