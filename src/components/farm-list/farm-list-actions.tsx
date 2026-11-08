"use client";

import { Button } from "@/components/ui/button";
import { isFarmDone, type FarmEntry } from "@/lib/farm-list/types";
import { useFarmListMutations } from "@/lib/farm-list/use-farm-list";
import { toast } from "@/lib/toast";

export function RemoveButton({ entry, label }: { entry: FarmEntry; label: string }) {
  const { remove } = useFarmListMutations();
  return (
    <Button
      variant="outline"
      disabled={remove.isPending}
      onClick={() =>
        remove.mutate(entry.id, {
          onError: (err) => toast.error("Couldn't remove it from your Farm list", err.message),
        })
      }
    >
      {label}
    </Button>
  );
}

/**
 * A new drop can be kept (Done, which leaves it on the list as a record) or sent back to
 * waiting (Not this one). A record can only be cleared.
 */
export function ObtainedActions({ entry }: { entry: FarmEntry }) {
  const { patch } = useFarmListMutations();
  if (isFarmDone(entry)) return <RemoveButton entry={entry} label="Remove" />;
  return (
    <>
      <Button
        variant="outline"
        disabled={patch.isPending}
        onClick={() =>
          patch.mutate(
            { id: entry.id, patch: { reject: true } },
            { onError: (err) => toast.error("Couldn't put it back on your Farm list", err.message) },
          )
        }
      >
        Not this one
      </Button>
      <Button
        variant="outline"
        disabled={patch.isPending}
        onClick={() =>
          patch.mutate(
            { id: entry.id, patch: { done: true } },
            { onError: (err) => toast.error("Couldn't mark it done", err.message) },
          )
        }
      >
        Done
      </Button>
    </>
  );
}
