"use client";

import { useSearchParams } from "next/navigation";
import type { Armory } from "@/lib/armory/fetch";
import type { RefreshResult } from "@/lib/armory/use-armory";
import type { Manifest } from "@/lib/manifest/load";
import { leaveOrAsk } from "@/lib/navigation/unsaved-changes";
import { InGameLoadoutsView } from "@/components/loadouts/ingame-loadouts-view";
import { LoadoutsList } from "@/components/loadouts/loadouts-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const IN_GAME_VIEW = "in-game";

/** Fills the page; a panel that isn't showing takes no space. */
const PANEL_CLASS = "flex min-h-0 flex-col text-base data-hidden:hidden";

/**
 * The loadouts page: tabs for the player's Conflux loadouts and their in-game slots.
 * The tab lives in the URL (`?view=in-game`), so a reload stays on it.
 */
export function LoadoutsPage({
  armory,
  provisional = false,
  manifest,
  onArmoryChanged,
  refreshArmory,
}: {
  armory: Armory;
  /** `armory` is last visit's copy; anything that equips waits for the live profile. */
  provisional?: boolean;
  manifest: Manifest;
  onArmoryChanged: () => void;
  /** Re-reads the profile and resolves with the new armory (an activity set runs on it). */
  refreshArmory: () => Promise<RefreshResult>;
}) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === IN_GAME_VIEW ? IN_GAME_VIEW : "conflux";

  const selectView = (next: unknown) =>
    leaveOrAsk(() => {
      const url = new URL(window.location.href);
      if (next === IN_GAME_VIEW) url.searchParams.set("view", IN_GAME_VIEW);
      else url.searchParams.delete("view");
      // Replace, not push: flipping tabs shouldn't fill the back stack.
      window.history.replaceState(null, "", url);
    });

  return (
    <Tabs value={view} onValueChange={selectView} className="min-h-0 flex-1 gap-4">
      <TabsList aria-label="Loadouts to show">
        <TabsTrigger value="conflux">Conflux</TabsTrigger>
        <TabsTrigger value={IN_GAME_VIEW}>In-game</TabsTrigger>
      </TabsList>
      {/* Kept mounted, so flipping tabs keeps each one's search, filters and scroll. */}
      <TabsContent value="conflux" keepMounted className={PANEL_CLASS}>
        <LoadoutsList
          armory={armory}
          provisional={provisional}
          manifest={manifest}
          onArmoryChanged={onArmoryChanged}
        />
      </TabsContent>
      <TabsContent value={IN_GAME_VIEW} keepMounted className={PANEL_CLASS}>
        <InGameLoadoutsView
          active={view === IN_GAME_VIEW}
          armory={armory}
          provisional={provisional}
          manifest={manifest}
          onArmoryChanged={onArmoryChanged}
          refreshArmory={refreshArmory}
        />
      </TabsContent>
    </Tabs>
  );
}
