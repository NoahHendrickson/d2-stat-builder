"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { getOptimizerStore } from "@/lib/optimizer/optimizer-store";
import { displayedBuildsStore } from "@/lib/build-usage/displayed-builds";
import {
  isBuildUsageRecording,
  subscribeBuildUsageRecording,
} from "@/lib/build-usage/recording-pref";
import { buildUsageKey, recordDisplayedBuilds } from "@/lib/build-usage/use-build-usage";
import { BUILD_USAGE_PAUSED } from "@/lib/build-usage/paused";

/**
 * How long a result has to stay on screen, with no newer search started, before its
 * query counts. Every slider step runs a search; only the ones the user stops on are
 * builds they were actually looking at.
 */
const SETTLE_MS = 4000;

/**
 * Records every optimizer result the user settles on into the account's usage history:
 * the builds the builder displayed for it, once the search (background refinement
 * included) is done. Watches the app-wide optimizer store, so a search finished on the
 * builder still counts after navigating away. Off when the device opted out in
 * Settings. Renders nothing.
 */
export function BuildUsageRecorder() {
  const membershipId = sessionMembershipId(useSession().data);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!membershipId || BUILD_USAGE_PAUSED) return;
    const store = getOptimizerStore();
    // What was last recorded: the query plus the displayed builds, so a re-sort that
    // changes what's on screen records again (replacing the query's rows) and anything
    // else (a re-render, an origin refresh) doesn't.
    let lastRecorded = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      if (!isBuildUsageRecording()) return;
      const { shown, running, refinement } = store.getSnapshot();
      const displayed = displayedBuildsStore.get();
      // A time-capped search keeps refining after its first list is up; wait for the
      // final one rather than record twice.
      if (!shown || running || refinement.phase === "running") return;
      if (!displayed || displayed.result !== shown.result) return;
      const classType = shown.origin.classType;
      if (classType === undefined) return;
      const signature =
        shown.key + "\n" + displayed.loadouts.map((l) => l.pieceIds.join(",")).join("|");
      if (signature === lastRecorded) return;
      timer = setTimeout(() => {
        lastRecorded = signature;
        recordDisplayedBuilds(shown.input, classType, displayed.loadouts, shown.result.loadouts)
          .then((ok) => {
            if (ok) void queryClient.invalidateQueries({ queryKey: buildUsageKey(membershipId) });
          })
          .catch(() => {
            // Best-effort: a missed query just isn't counted.
          });
      }, SETTLE_MS);
    };
    check();
    const unsubscribers = [
      store.subscribe(check),
      displayedBuildsStore.subscribe(check),
      subscribeBuildUsageRecording(check),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      clearTimeout(timer);
    };
  }, [membershipId, queryClient]);

  return null;
}
