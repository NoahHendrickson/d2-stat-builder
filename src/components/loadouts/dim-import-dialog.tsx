"use client";

import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { DimImportError, resolveDimLink } from "@/lib/loadouts/dim-import";
import type { SavedLoadoutData } from "@/lib/loadouts/types";
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

/**
 * Paste a DIM loadout link. Nothing is saved here: the loadout it finds goes on to the
 * import drawer, where the player can review it first.
 */
export function DimImportDialog({
  onOpenChange,
  onResolved,
}: {
  onOpenChange: (open: boolean) => void;
  onResolved: (data: SavedLoadoutData) => void;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !link.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onResolved(await resolveDimLink(link));
    } catch (err) {
      setError(err instanceof DimImportError ? err.message : "That DIM loadout can't be read");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form className="contents" onSubmit={(e) => void submit(e)}>
          <DialogHeader className="pr-8">
            <DialogTitle>Import DIM loadout</DialogTitle>
            <DialogDescription>
              In DIM, open the loadout, choose Share, and paste the link here.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError(null);
              }}
              placeholder="https://dim.gg/…"
              aria-label="DIM loadout link"
              aria-invalid={error !== null}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="gap-1.5" disabled={busy || !link.trim()}>
              {busy && <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />}
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
