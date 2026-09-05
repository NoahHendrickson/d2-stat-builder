"use client";

import { useId, useState, type FormEvent } from "react";
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
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/lib/loadouts/types";

interface DetailsProps {
  title: string;
  description?: string;
  submitLabel: string;
  initialName: string;
  initialNotes?: string;
  busy?: boolean;
  onSubmit: (values: { name: string; notes: string }) => void;
  onCancel: () => void;
}

/**
 * Name + notes form shared by Save (from a build), Edit, and Import. The caller owns
 * the mutation; this only collects the two fields and reports busy/disabled state.
 * The form mounts fresh each time the dialog opens, so its fields re-seed from props
 * without an effect (one dialog instance serves many rows).
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
      <DialogContent>
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
  busy = false,
  onSubmit,
  onCancel,
}: DetailsProps) {
  const [name, setName] = useState(initialName);
  const [notes, setNotes] = useState(initialNotes);
  const nameId = useId();
  const notesId = useId();

  const trimmed = name.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH && !busy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: trimmed, notes: notes.trim() });
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="space-y-3">
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
            rows={3}
            placeholder="#raid #pve, what it's for, swap notes…"
          />
        </div>
      </div>
      <DialogFooter>
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
