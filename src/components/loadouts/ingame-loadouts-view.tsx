"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, FloppyDiskIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import type { Armory } from "@/lib/armory/fetch";
import type { RefreshResult } from "@/lib/armory/use-armory";
import type { Manifest } from "@/lib/manifest/load";
import { MAX_ACTIVITY_SETS, type ActivitySet } from "@/lib/loadouts/activity-sets";
import {
  runActivitySet,
  stopActivitySet,
  useActivitySetRun,
} from "@/lib/loadouts/activity-set-run";
import { rereadInGameSlots, useSlotsSettling } from "@/lib/loadouts/ingame-save";
import { CLASS_NAMES } from "@/lib/armory/stats";
import { CharacterEmblemTabs } from "@/components/builder/class-emblem-tabs";
import { ActivitySetCards } from "@/components/loadouts/activity-set-cards";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import { InGameSlotDialogs, type SlotDialog } from "@/components/loadouts/ingame-slot-dialogs";
import { CurrentSlotDetail, SetSlotDetail } from "@/components/loadouts/ingame-slot-detail";
import { InGameSlotGrid } from "@/components/loadouts/ingame-slot-grid";
import { LoadoutEditorDrawer } from "@/components/loadouts/loadout-editor-drawer";
import { SetCard, SetRowAction, SlotsState } from "@/components/loadouts/set-card";
import { useSetEditor } from "@/components/loadouts/use-set-editor";
import { useSlotActions } from "@/components/loadouts/use-slot-actions";
import { useSlotEditor } from "@/components/loadouts/use-slot-editor";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The In-game tab of the loadouts page. Per character: what's in each in-game slot right
 * now, and the activity sets (saved loadouts assigned to slots) built on this screen.
 */
export function InGameLoadoutsView({
  active,
  armory,
  provisional,
  manifest,
  onArmoryChanged,
  refreshArmory,
}: {
  /** The tab is showing. It stays mounted while hidden. */
  active: boolean;
  armory: Armory;
  provisional: boolean;
  manifest: Manifest;
  onArmoryChanged: () => void;
  refreshArmory: () => Promise<RefreshResult>;
}) {
  const queryClient = useQueryClient();
  const setRun = useActivitySetRun();
  // Nothing is fetched until the tab is first opened; after that it stays up to date.
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  const sets = useSetEditor({ armory, manifest, active: opened });
  const { character, activeSet, activeSetCharacter, inGame, slots, filled, selectedSlot } = sets;
  const { isFetching, refetch } = sets.slotsQuery;
  // A write is waiting on Bungie, so the slots shown may still be the old ones.
  const settling = useSlotsSettling(character?.id);

  const slotActions = useSlotActions({
    armory,
    character,
    identifiers: inGame?.identifiers,
    pieceMap: sets.pieceMap,
    weaponMap: sets.weaponMap,
    manifest,
    provisional,
    blocked: setRun !== null,
    onArmoryChanged,
  });
  const editor = useSlotEditor({ sets, armory, manifest, saveToSlot: slotActions.saveToSlot });

  const [dialog, setDialog] = useState<SlotDialog>({ kind: "none" });
  const [peek, setPeek] = useState(false);

  const gearLocked = provisional || slotActions.applying;
  /** Copying a slot now could store gear it no longer holds, or lose its mods. */
  const copyLocked = provisional || settling;
  const atSetLimit = sets.allSets.length >= MAX_ACTIVITY_SETS;
  // Which slots the open set fills. A name of null means its loadout has been deleted,
  // which can only be said once the loadouts are in.
  const assignments =
    activeSet &&
    new Map(
      activeSet.slots.map((s) => [
        s.index,
        sets.setLoadouts.find((l) => l.id === s.loadoutId)?.loadout.name ??
          (sets.loadoutsLoaded ? null : "Loading your loadouts…"),
      ]),
    );
  const assignment = selectedSlot && activeSet?.slots.find((s) => s.index === selectedSlot.index);
  const setLocked = !!activeSet && (setRun?.setId === activeSet.id || sets.saving);

  const runSet = (set: ActivitySet) =>
    void runActivitySet({
      set,
      loadouts: sets.all,
      armory,
      refreshArmory,
      manifest,
      queryClient,
    }).finally(() => rereadInGameSlots(queryClient, set.characterId));

  // Drawn inside whichever entry on the left is open.
  const slotGrid =
    activeSet && !activeSetCharacter ? (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-sm">
          This set&apos;s character is no longer on your account, so it can&apos;t be applied to the game.
        </p>
        {character?.classType === activeSet.classType && (
          <Button size="sm" onClick={() => sets.moveSetTo(activeSet, character.id)} disabled={setLocked}>
            Move to this {CLASS_NAMES[character.classType] ?? "character"}
          </Button>
        )}
      </div>
    ) : !inGame || slots.length === 0 ? (
      <SlotsState
        hasCharacter={!!character}
        data={inGame}
        error={sets.slotsQuery.error}
        isFetching={isFetching}
        onRetry={() => void refetch()}
      />
    ) : (
      <InGameSlotGrid
        slots={slots}
        identifiers={inGame.identifiers}
        selectedIndex={selectedSlot?.index}
        onSelect={sets.selectSlot}
        assignments={assignments}
        labelsFor={(index) => activeSet?.slots.find((s) => s.index === index)?.labels}
        peek={peek}
        onToggleSlot={
          activeSet && activeSetCharacter && !setLocked && !copyLocked ? sets.toggleSlot : undefined
        }
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="max-w-2xl shrink-0">
        <CharacterEmblemTabs
          characters={armory.characters}
          value={character?.id ?? ""}
          onChange={sets.selectCharacter}
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
            onClick={sets.openCurrent}
            titleAction={
              !activeSet && (
                <SetRowAction
                  tooltip="Reload from the game"
                  label="Reload from the game"
                  icon={RefreshIcon}
                  iconClassName={cn((isFetching || settling) && "animate-spin")}
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
                  onClick={sets.startSetFromSlots}
                  disabled={filled.length === 0 || atSetLimit || isFetching || copyLocked}
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
                onClick={sets.startNewSet}
                disabled={!character || atSetLimit}
              >
                <HugeiconsIcon icon={Add01Icon} aria-hidden />
              </Button>
            </TooltipLabel>
          </div>

          <ActivitySetCards
            sets={sets}
            slotGrid={slotGrid}
            run={setRun}
            canRun={!gearLocked && sets.loadoutsLoaded}
            onRun={runSet}
            onStop={stopActivitySet}
            onDelete={(set) => setDialog({ kind: "delete-set", set })}
          />
        </nav>

        <div className="d2-scroll flex min-w-0 flex-1 flex-col gap-3 lg:-m-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:p-1">
          <div className="min-w-0 shrink-0">
            {inGame && selectedSlot && character && (!activeSet || activeSetCharacter) &&
              (activeSet ? (
                <SetSlotDetail
                  key={`${activeSet.id}-${selectedSlot.index}`}
                  slot={selectedSlot}
                  identifiers={inGame.identifiers}
                  loadoutId={assignment?.loadoutId}
                  labels={assignment?.labels}
                  classType={activeSet.classType}
                  peek={peek}
                  onPeekChange={setPeek}
                  canPeek={filled.length > 0}
                  loadouts={sets.setLoadouts}
                  loadoutsLoaded={sets.loadoutsLoaded}
                  options={sets.options}
                  pieceMap={sets.pieceMap}
                  weaponMap={sets.weaponMap}
                  manifest={manifest}
                  disabled={setLocked}
                  copyDisabled={copyLocked}
                  onAssign={(loadoutId) => sets.assignSlot(selectedSlot.index, loadoutId)}
                  onCopySlot={() => sets.copySlotIntoSet(selectedSlot)}
                  onCustomize={(slot) => setDialog({ kind: "customize-set-slot", slot })}
                  onEditLoadout={editor.editSetLoadout}
                />
              ) : (
                <CurrentSlotDetail
                  key={selectedSlot.index}
                  slot={selectedSlot}
                  identifiers={inGame.identifiers}
                  classType={character.classType}
                  pieceMap={sets.pieceMap}
                  weaponMap={sets.weaponMap}
                  manifest={manifest}
                  disabled={gearLocked || settling || setRun !== null}
                  onEdit={() => editor.editSlot(selectedSlot)}
                  onCustomize={() => setDialog({ kind: "customize", slot: selectedSlot })}
                  onReplace={() => setDialog({ kind: "pick", slot: selectedSlot })}
                  onCopy={() => editor.copySlot(selectedSlot)}
                  onDelete={() => setDialog({ kind: "delete", slot: selectedSlot })}
                />
              ))}
          </div>
        </div>
      </div>

      <InGameSlotDialogs
        dialog={dialog}
        setDialog={setDialog}
        identifiers={inGame?.identifiers}
        character={character}
        options={sets.options}
        manifest={manifest}
        onSaveToSlot={(saved, choice) => void slotActions.saveToSlot(saved, choice)}
        onCustomizeSlot={(slot, labels) => void slotActions.customizeSlot(slot, labels)}
        onLabelSetSlot={sets.labelSlot}
        onDeleteSlot={(slot) => void slotActions.deleteSlot(slot)}
        onDeleteSet={sets.deleteSet}
      />
      <ConfirmDialog
        open={sets.leaving !== null}
        onOpenChange={(open) => !open && sets.stayOnSet()}
        title="Discard unsaved changes?"
        description={`Your changes to ${activeSet?.name.trim() || "this new set"} haven't been saved. Keep editing to save them, or discard them to leave.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        busy={sets.saving}
        onConfirm={sets.confirmLeave}
      />

      <LoadoutEditorDrawer {...editor.drawer} />
    </div>
  );
}
