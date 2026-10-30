import { CONTROL_STORIES } from "@/components/playground/stories/controls";
import { DISPLAY_STORIES } from "@/components/playground/stories/display";
import { OVERLAY_STORIES } from "@/components/playground/stories/overlays";
import type { Story } from "@/components/playground/story";

/** Every component on /components, in index order. Add a story to its group's file. */
export const STORIES: readonly Story[] = [
  ...CONTROL_STORIES,
  ...OVERLAY_STORIES,
  ...DISPLAY_STORIES,
];
