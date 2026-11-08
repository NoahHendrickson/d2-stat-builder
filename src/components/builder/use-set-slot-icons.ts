"use client";

import { useCallback } from "react";
import { setSlotIcons, type SetSlotIcons } from "@/lib/armory/sets";
import type { Manifest } from "@/lib/manifest/load";

/** Looks up a set's own item art per slot, for one class. */
export function useSetSlotIcons(
  manifest: Manifest | undefined,
  classType: number | null,
): (setHash: number) => SetSlotIcons {
  return useCallback(
    (setHash: number) =>
      manifest && classType !== null ? setSlotIcons(manifest, setHash, classType) : {},
    [manifest, classType],
  );
}
