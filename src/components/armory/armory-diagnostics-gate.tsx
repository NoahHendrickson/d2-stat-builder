"use client";

import { useQuery } from "@tanstack/react-query";
import { ArmoryDiagnostics } from "@/components/armory/armory-diagnostics";
import { fetchProfileItemCounts } from "@/lib/armory/fetch-profile-counts";
import { useArmory } from "@/lib/armory/use-armory";
import { useArmoryDebug } from "@/lib/armory/use-armory-debug";
import { useSession } from "@/lib/auth/use-session";
import { useManifest } from "@/lib/manifest/use-manifest";

const DIAGNOSTICS_COUNTS_KEY = ["armory-diagnostics-counts"];

function manifestLine(
  status: ReturnType<typeof useManifest>,
): string {
  if (status.state === "ready") return `ready (${status.manifest.version})`;
  if (status.state === "loading") return "loading…";
  if (status.state === "error") return `error: ${status.message}`;
  return "idle";
}

/**
 * Self-contained diagnostics gate: owns visibility policy, hook subscriptions,
 * and the support-only profile count fetch. ArmoryStatus just mounts this.
 */
export function ArmoryDiagnosticsGate() {
  const session = useSession();
  const debugMode = useArmoryDebug();
  const manifestStatus = useManifest();
  const { data, isLoading, isError, error } = useArmory();

  const pieces = data?.pieces ?? [];
  const characterCount = data?.characters.length ?? 0;
  const show =
    debugMode ||
    (!isLoading &&
      (isError ||
        (data != null && (characterCount === 0 || pieces.length === 0))));

  const rawItemsQuery = useQuery({
    queryKey: DIAGNOSTICS_COUNTS_KEY,
    queryFn: fetchProfileItemCounts,
    enabled: show && !isLoading && !isError,
    staleTime: 0,
  });

  if (!show) return null;

  const linkedDestinyProfile = Boolean(
    session.data?.user?.destinyMembershipId &&
      session.data.user.destinyMembershipType != null,
  );

  return (
    <ArmoryDiagnostics
      linkedDestinyProfile={linkedDestinyProfile}
      characterCount={characterCount}
      normalizedArmor={pieces.length}
      manifestLine={manifestLine(manifestStatus)}
      rawItems={rawItemsQuery.data}
      loadError={
        isError ? ((error as Error)?.message ?? "unknown error") : undefined
      }
    />
  );
}
