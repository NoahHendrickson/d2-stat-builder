"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link01Icon, LinkOffIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { SuperIcon } from "@/components/loadouts/loadout-icons";
import { CLASS_NAMES } from "@/lib/armory/stats";
import type { ArmorPiece } from "@/lib/armory/normalize";
import type { Manifest } from "@/lib/manifest/load";
import { resolveLoadout } from "@/lib/loadouts/resolve";
import {
  setOptimizingLoadout,
  useOptimizingLoadout,
} from "@/lib/loadouts/optimizing-loadout";

const NO_PIECES: ReadonlyMap<string, ArmorPiece> = new Map();

/**
 * The saved loadout the optimizer is linked to (Optimize on /loadouts), above the build
 * list: its Super and name, as on its card. Build cards offer Update loadout for it
 * until Unlink.
 */
export function LinkedLoadoutBanner({
  classType,
  manifest,
}: {
  classType: number | null;
  manifest?: Manifest;
}) {
  const saved = useOptimizingLoadout();
  // Only the subclass is read, so no armory is needed.
  const subclass = useMemo(
    () => (saved && manifest ? resolveLoadout(saved.loadout, NO_PIECES, manifest).subclass : undefined),
    [saved, manifest],
  );
  if (!saved) return null;
  const loadoutClass = saved.loadout.classType;
  const otherClass = loadoutClass < 3 && classType !== null && classType !== loadoutClass;
  return (
    <div
      role="note"
      aria-label={`Linked loadout: ${saved.loadout.name}`}
      className="d2-reveal d2-line flex items-center gap-3 bg-white/6 p-3"
    >
      {subclass && manifest ? (
        <SuperIcon manifest={manifest} subclass={subclass} size={40} showTooltip={false} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden>
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="text-muted-foreground size-5" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="d2-label text-muted-foreground flex items-center gap-1 text-[10px]">
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} className="text-muted-foreground size-3" aria-hidden />
          Linked loadout
        </span>
        <span className="truncate text-base font-medium">{saved.loadout.name}</span>
        <span className="text-muted-foreground text-xs">
          {otherClass
            ? `Switch to ${CLASS_NAMES[loadoutClass] ?? "its class"} to update ${saved.loadout.name}.`
            : `Update loadout on a build saves it to ${saved.loadout.name}.`}
        </span>
      </div>
      <Button variant="outline" onClick={() => setOptimizingLoadout(null)} className="shrink-0">
        <HugeiconsIcon icon={LinkOffIcon} strokeWidth={2} aria-hidden />
        Unlink
      </Button>
    </div>
  );
}
