import { createValueStore } from "@/lib/value-store";

/**
 * The builder's live stat targets, held outside React so a build row's stat chips can
 * light up when a target is met without the (memoized) rows re-rendering on every
 * slider move. BuilderPanel publishes here from a layout effect; each `StatValue` chip
 * subscribes with a selector that yields only its own met/unmet boolean.
 */
export const liveTargets = createValueStore<number[]>([0, 0, 0, 0, 0, 0]);
