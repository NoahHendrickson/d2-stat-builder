"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Armory } from "./fetch";
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
  armoryQuery: UseQueryResult<Armory>;
  classType: number | null;
  fragments: Record<Subclass, FragmentInfo[]> | null | undefined;
}) {
  const [applying, setApplying] = useState(false);
  const canApply = classType !== null && Boolean(armoryQuery.data) && Boolean(fragments);

  const apply = async (): Promise<ApplyCurrentFragmentsResult | null> => {
    if (classType === null || !fragments) return null;
    setApplying(true);
    try {
      const result = await armoryQuery.refetch();
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
  };

  return { applying, apply, canApply };
}
