"use client";

// The builds the builder is actually displaying for the shown result: its first
// MAX_SHOWN after the user's build sort. The usage recorder counts these, not the
// solver's order, so the history matches what was on screen.
import { createValueStore } from "@/lib/value-store";
import type { OptimizerLoadout, OptimizerOutput } from "@/lib/optimizer/types";

export interface DisplayedBuilds {
  /** The optimizer result these builds were taken from. */
  result: OptimizerOutput;
  loadouts: readonly OptimizerLoadout[];
}

export const displayedBuildsStore = createValueStore<DisplayedBuilds | null>(null);
