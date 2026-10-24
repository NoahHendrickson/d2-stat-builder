"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import type { OptimizerInput, OptimizerLoadout } from "@/lib/optimizer/types";
import type { BuildUsageSummary } from "./buckets";
import { queryIdentity, summarizeRun } from "./summarize";
import { encodeRecord } from "./wire";
import { BUILD_USAGE_PAUSED } from "./paused";

export const buildUsageKey = (membershipId: string | undefined) => ["build-usage", membershipId] as const;

/** The account's armor usage history (see /api/build-usage). */
export function useBuildUsage() {
  const membershipId = sessionMembershipId(useSession().data);
  return useQuery<BuildUsageSummary>({
    queryKey: buildUsageKey(membershipId),
    enabled: membershipId !== undefined && !BUILD_USAGE_PAUSED,
    staleTime: 30_000,
    // 503 (storage not configured) and 401 won't change by retrying.
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/build-usage", { cache: "no-store" });
      if (!res.ok) throw new Error(`Build usage request failed (${res.status})`);
      return (await res.json()) as BuildUsageSummary;
    },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Record one query with the builds displayed for it (and the whole result, for the
 * builds that tie them; see summarizeRun). Resolves false when there was nothing to record.
 */
export async function recordDisplayedBuilds(
  input: OptimizerInput,
  classType: number,
  displayed: readonly OptimizerLoadout[],
  returned: readonly OptimizerLoadout[],
): Promise<boolean> {
  if (displayed.length === 0) return false;
  const pieces = summarizeRun(input, displayed, returned);
  if (pieces.length === 0) return false;
  const key = await sha256Hex(queryIdentity(input, classType));
  const res = await fetch("/api/build-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(encodeRecord(key, pieces)),
  });
  return res.ok;
}

/** Forget the account's usage history. Resolves whether the server did. */
export async function clearBuildUsage(): Promise<boolean> {
  const res = await fetch("/api/build-usage", { method: "DELETE" });
  return res.ok;
}
