"use client";

import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Loading03Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import type { ActivitySetRunState } from "@/lib/loadouts/activity-set-run";
import { MAX_ACTIVITY_SET_NAME_LENGTH, type ActivitySet } from "@/lib/loadouts/activity-sets";
import { setFooterStatus } from "@/lib/loadouts/set-draft";
import { ActivitySetFooter } from "@/components/loadouts/activity-set-panel";
import {
  SetCard,
  SetRenameInput,
  SetRowAction,
  UNSAVED_DOT,
} from "@/components/loadouts/set-card";
import type { SetEditor } from "@/components/loadouts/use-set-editor";
import { Input } from "@/components/ui/input";

/** The character's activity sets, listed down the left column; the open one is expanded. */
export function ActivitySetCards({
  sets,
  slotGrid,
  run,
  canRun,
  onRun,
  onStop,
  onDelete,
}: {
  sets: SetEditor;
  /** Drawn inside the open set. */
  slotGrid: ReactNode;
  run: ActivitySetRunState | null;
  canRun: boolean;
  onRun: (set: ActivitySet) => void;
  onStop: () => void;
  onDelete: (set: ActivitySet) => void;
}) {
  const [renamingId, setRenamingId] = useState<string>();
  const { activeSet, newSet, saving, unsaved } = sets;
  const listed = newSet ? [...sets.sets, newSet] : sets.sets;

  return (
    <>
      {listed.map((entry) => {
        const open = entry.id === activeSet?.id;
        const set = open ? activeSet : entry;
        const running = run?.setId === set.id;
        const locked = running || saving;
        return (
          <SetCard
            key={set.id}
            title={set.name.trim() || "New set"}
            open={open}
            onClick={() => sets.openSet(set.id)}
            nameField={
              entry === newSet ? (
                <>
                  <Input
                    ref={sets.nameInputRef}
                    value={set.name}
                    onChange={(e) => sets.typeDraftName(e.target.value)}
                    maxLength={MAX_ACTIVITY_SET_NAME_LENGTH}
                    placeholder="Name this set"
                    aria-label="Set name"
                    aria-invalid={sets.nameMissing || undefined}
                    required
                    autoFocus
                    disabled={saving}
                    className="aria-invalid:placeholder:text-destructive min-w-0 flex-1"
                  />
                  {UNSAVED_DOT}
                </>
              ) : renamingId === entry.id ? (
                <SetRenameInput
                  name={entry.name}
                  onDone={(name) => {
                    setRenamingId(undefined);
                    if (name && name !== entry.name) sets.renameSet(entry, name);
                  }}
                />
              ) : undefined
            }
            titleAction={
              <SetRowAction
                tooltip="Rename"
                label={`Rename ${set.name}`}
                icon={PencilEdit02Icon}
                onClick={() => setRenamingId(entry.id)}
                disabled={locked}
              />
            }
            trailing={
              running ? (
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
                onClick={() => onDelete(entry)}
                disabled={locked}
              />
            }
          >
            <div className="flex flex-col gap-3">
              {slotGrid}
              <ActivitySetFooter
                set={set}
                loadouts={sets.setLoadouts}
                status={setFooterStatus({
                  set,
                  isNew: !!newSet,
                  dirty: sets.setDirty,
                  saving,
                  hasCharacter: !!sets.activeSetCharacter,
                  run,
                  canRun,
                })}
                saveAttention={sets.saveAttention}
                onSaveAttentionEnd={sets.clearSaveAttention}
                onSave={() => void sets.saveDraft()}
                onDiscard={sets.discardDraft}
                onRun={onRun}
                onStop={onStop}
              />
            </div>
          </SetCard>
        );
      })}
      {listed.length === 0 && (
        <p className="text-muted-foreground px-1 text-xs">
          Group loadouts by activity and apply them to the game together.
        </p>
      )}
    </>
  );
}
