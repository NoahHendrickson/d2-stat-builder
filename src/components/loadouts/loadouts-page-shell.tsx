"use client";

import { useCallback } from "react";
import { SignInCard } from "@/components/auth/sign-in-card";
import { useSession } from "@/lib/auth/use-session";
import { useArmory } from "@/lib/armory/use-armory";
import { useManifest } from "@/lib/manifest/use-manifest";
import { ArmoryStatus } from "@/components/armory/armory-status";
import { ManifestStatus } from "@/components/manifest/manifest-status";
import { LoadoutsList } from "@/components/loadouts/loadouts-list";

export function LoadoutsPageShell() {
  const session = useSession();
  const armory = useArmory();
  const manifestStatus = useManifest();
  const authed = session.data?.authenticated ?? false;

  // Stable identity: this reaches every memoized row, so a fresh closure per render
  // would re-render the whole visible list each time an observer notifies the shell.
  const { refetch: refetchArmory } = armory;
  const onArmoryChanged = useCallback(() => void refetchArmory(), [refetchArmory]);

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-6 py-6">
        <SignInCard />
      </main>
    );
  }

  // Rows resolve items against the live armory and read icons from the manifest, so
  // wait for both — same status cards the builder and table show.
  if (!armory.data || manifestStatus.state !== "ready") {
    return (
      <main className="mx-auto max-w-md space-y-4 px-6 py-6">
        <ManifestStatus />
        <ArmoryStatus />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <LoadoutsList
        armory={armory.data}
        manifest={manifestStatus.manifest}
        onArmoryChanged={onArmoryChanged}
      />
    </main>
  );
}
