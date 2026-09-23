"use client";

import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";
import type { ArmoryQuery } from "./use-armory";
import type { FragmentInfo, Subclass } from "./fragments";
import { characterForClass } from "./character-for-class";
import { fragSelFromEquipped } from "./frag-sel-from-equipped";

export type ApplyCurrentFragmentsResult = {
  subclass: Subclass;
  fragmentHashes: Set<number>;
};

/**
 * Refetch profile → read equipped subclass/fragments for the selected class →
 * return a filtered fragSel update. Toasts on failure; caller applies state.
 */
export function useApplyCurrentFragments({
  armoryQuery,
  classType,
  fragments,
}: {
  armoryQuery: ArmoryQuery;
  classType: number | null;
  fragments: Record<Subclass, FragmentInfo[]> | null | undefined;
}) {
  const [applying, setApplying] = useState(false);
  const canApply = classType !== null && Boolean(armoryQuery.data) && Boolean(fragments);

  // Memoized: it reaches the (memo'd) FragmentPicker through the panel's click handler,
  // so a fresh closure per render would re-render the whole fragment grid on every
  // slider tick.
  const refetch = armoryQuery.refetch;
  const apply = useCallback(async (): Promise<ApplyCurrentFragmentsResult | null> => {
    if (classType === null || !fragments) return null;
    setApplying(true);
    try {
      const result = await refetch();
      if (result.error || !result.data) {
        toast.error("Couldn't refresh profile — try again");
        return null;
      }
      const character = characterForClass(result.data.characters, classType);
      const equipped = character?.equippedSubclass;
      if (!equipped) {
        toast.error("No subclass found on this character");
        return null;
      }
      const known = new Set(fragments[equipped.subclass].map((f) => f.hash));
      return {
        subclass: equipped.subclass,
        fragmentHashes: fragSelFromEquipped(equipped.fragmentHashes, known),
      };
    } finally {
      setApplying(false);
    }
  }, [classType, fragments, refetch]);

  return { applying, apply, canApply };
}
