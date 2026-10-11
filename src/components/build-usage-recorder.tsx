"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { getOptimizerStore } from "@/lib/optimizer/optimizer-store";
import type { OptimizerOutput } from "@/lib/optimizer/types";
import { buildUsageKey, recordShownResult } from "@/lib/build-usage/use-build-usage";

/**
 * How long a result has to stay on screen, with no newer search started, before its
 * query counts. Every slider step runs a search; only the ones the user stops on are
 * builds they were actually looking at.
 */
const SETTLE_MS = 4000;

/**
 * Records every optimizer result the user settles on into the account's usage history.
 * Watches the app-wide optimizer store, so a search finished on the builder still
 * counts after navigating away. Renders nothing.
 */
export function BuildUsageRecorder() {
  const membershipId = sessionMembershipId(useSession().data);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!membershipId) return;
    const store = getOptimizerStore();
    const recorded = new WeakSet<OptimizerOutput>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      const { shown, running } = store.getSnapshot();
      if (!shown || running || recorded.has(shown.result)) return;
      timer = setTimeout(() => {
        recorded.add(shown.result);
        recordShownResult(shown)
          .then((ok) => {
            if (ok) void queryClient.invalidateQueries({ queryKey: buildUsageKey(membershipId) });
          })
          .catch(() => {
            // Best-effort: a missed query just isn't counted.
          });
      }, SETTLE_MS);
    };
    check();
    const unsubscribe = store.subscribe(check);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [membershipId, queryClient]);

  return null;
}
