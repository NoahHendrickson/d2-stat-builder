"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ShoppingCartAdd02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import type { ArmorPiece } from "@/lib/armory/normalize";
import { armorFarmTitle, armorPlaceLabel } from "@/lib/farm-list/armor";
import type { ArmorFarmData } from "@/lib/farm-list/types";
import type { ArmorFarming } from "@/lib/farm-list/use-armor-farming";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Puts a piece a build needs on the Farm list, or takes it off again. If a copy that
 * already fits is owned it says where and offers "Add anyway" (that copy then never
 * counts as the drop). `compact` is the icon alone, for a row of a results card.
 */
export function FarmArmorButton({
  data,
  farming,
  compact = false,
}: {
  data: ArmorFarmData;
  /** Null until the list has loaded: nothing to show yet. */
  farming: ArmorFarming | null;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [owned, setOwned] = useState<ArmorPiece[] | null>(null);
  // A compact button is a grid cell: hold its place so the row's columns stay put.
  if (!farming) return compact ? <span aria-hidden className="size-7" /> : null;
  const existing = farming.entryFor(data);

  async function run(action: () => Promise<unknown>, failed: string) {
    setBusy(true);
    try {
      await action();
      setOwned(null);
    } catch (err) {
      toast.error(failed, err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  const save = (ignored: string[]) =>
    run(() => farming!.add(data, ignored), "Couldn't add it to your Farm list");

  function onClick() {
    if (existing) {
      void run(() => farming!.remove(existing.id), "Couldn't remove it from your Farm list");
      return;
    }
    const copies = farming!.owned(data);
    if (copies.length > 0) setOwned(copies);
    else void save([]);
  }

  const title = armorFarmTitle(data);
  const label = existing ? `Remove ${title} from your Farm list` : `Add ${title} to your Farm list`;
  const cart = <HugeiconsIcon icon={ShoppingCartAdd02Icon} aria-hidden className="size-4" />;
  return (
    <>
      <Button
        size={compact ? "icon-sm" : "xs"}
        variant={compact ? "ghost" : "outline"}
        disabled={busy}
        aria-pressed={existing !== undefined}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        onClick={onClick}
        className={cn("d2-hover-ring shrink-0 rounded-none", existing && "text-power")}
      >
        {cart}
        {!compact && (existing ? "On your Farm list" : "Add to Farm list")}
      </Button>
      {owned && !existing && (
        <span className="col-span-full flex basis-full flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            You already have this roll {armorPlaceLabel(owned[0]!)}.
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => void save(owned.map((p) => p.instanceId))}
          >
            Add anyway
          </Button>
        </span>
      )}
    </>
  );
}
