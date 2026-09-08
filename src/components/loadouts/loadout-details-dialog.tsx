"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pieceEnergyUsed, type ModsSection } from "@/lib/loadouts/mod-placement";
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH, type ModPlacement } from "@/lib/loadouts/types";
import { LoadoutModsEditor } from "@/components/loadouts/loadout-mods-editor";
import { cn } from "@/lib/utils";
import { subclassSelectionValid } from "@/lib/loadouts/subclass";
import type { DimLoadoutItem } from "@/lib/dim/loadout-link";
import { LoadoutSubclassEditor, type SubclassSection } from "./loadout-subclass-editor";

export type { ModsSection } from "@/lib/loadouts/mod-placement";

export interface LoadoutDetailsValues {
  name: string;
  notes: string;
  /** Present only when a `mods` section was shown. */
  placement?: ModPlacement;
  subclass?: DimLoadoutItem | null;
}

interface DetailsProps {
  title: string;
  description?: string;
  submitLabel: string;
  initialName: string;
  initialNotes?: string;
  mods?: ModsSection;
  subclass?: SubclassSection;
  busy?: boolean;
  onSubmit: (values: LoadoutDetailsValues) => void;
  onCancel: () => void;
}

/**
 * Name + notes (+ optional mod picker) form shared by Save (from a build), Edit, and
 * Import. The caller owns the mutation; this only collects the fields and reports
 * busy/disabled state. The form mounts fresh each time the dialog opens, so its
 * fields re-seed from props without an effect (one dialog instance serves many rows).
 */
export function LoadoutDetailsDialog({
  open,
  onOpenChange,
  ...form
}: Omit<DetailsProps, "onCancel"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn((form.mods || form.subclass) && "sm:max-w-2xl")}>
        {open && <DetailsForm {...form} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({
  title,
  description,
  submitLabel,
  initialName,
  initialNotes = "",
  mods,
  subclass,
  busy = false,
  onSubmit,
  onCancel,
}: DetailsProps) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const [placement, setPlacement] = useState<ModPlacement>(mods?.initial ?? {});
  const [subclassItem, setSubclassItem] = useState(subclass?.initial ?? null);
  const nameId = useId();
  const notesId = useId();

  const trimmed = name.trim();
  const overEnergy =
    mods !== undefined &&
    mods.pieces.some((p) => {
      const cap = p.energy?.capacity;
      return (
        cap !== undefined &&
        pieceEnergyUsed(p, placement[p.instanceId], (h) => mods.catalog.option(h)?.cost ?? 0) >
          cap
      );
    });
  const subclassValid = useMemo(
    () => !subclass || subclassSelectionValid(subclass, subclassItem),
    [subclass, subclassItem],
  );
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !busy && !overEnergy &&
    subclassValid;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: trimmed, notes: notes.trim(), ...(mods ? { placement } : {}), ...(subclass ? { subclass: subclassItem } : {}) });
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={notesId} className="text-sm font-medium">
            Notes{" "}
            <span className="text-muted-foreground font-normal">
              (optional — #hashtags become filters)
            </span>
          </label>
          <Textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={MAX_NOTES_LENGTH}
            rows={2}
            placeholder="#raid #pve, what it's for, swap notes…"
          />
        </div>
        {subclass && <LoadoutSubclassEditor section={subclass} value={subclassItem} onChange={setSubclassItem} />}
        {mods && (
          <LoadoutModsEditor
            pieces={mods.pieces}
            catalog={mods.catalog}
            value={placement}
            onChange={setPlacement}
          />
        )}
        {mods && mods.skipped.length > 0 && (
          <div className="border-border/60 bg-muted/40 rounded-lg border px-3 py-2 text-xs">
            <p className="font-medium">
              {mods.skipped.length === 1
                ? "1 mod doesn't fit your current armor"
                : `${mods.skipped.length} mods don't fit your current armor`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              They stay in the loadout and will be socketed when the armor can take them
              (or place them by hand above).
            </p>
            <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-4">
              {mods.skipped.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <DialogFooter>
        {overEnergy && (
          <span className="text-destructive mr-auto self-center text-xs">
            A piece is over its armor energy.
          </span>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {busy ? <CircleNotch className="animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
