"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowsCounterClockwise,
  CheckCircle,
  CircleNotch,
  CloudCheck,
  SignOut,
  XCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { useArmory } from "@/lib/armory/use-armory";
import { useSession } from "@/lib/auth/use-session";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { useManifest } from "@/lib/manifest/use-manifest";
import { toast } from "@/lib/toast";

const REFRESH_SUCCESS_MS = 2500;

function StatusIcon({
  state,
}: {
  state: "ready" | "loading" | "error" | "idle";
}) {
  if (state === "loading") {
    return (
      <CircleNotch
        weight="duotone"
        className="size-4 shrink-0 animate-spin"
        aria-hidden
      />
    );
  }
  if (state === "error") {
    return (
      <XCircle
        weight="duotone"
        className="text-destructive size-4 shrink-0"
        aria-hidden
      />
    );
  }
  if (state === "ready") {
    return (
      <CloudCheck
        weight="duotone"
        className="size-4 shrink-0 text-emerald-500"
        aria-hidden
      />
    );
  }
  return (
    <CloudCheck
      weight="duotone"
      className="text-muted-foreground size-4 shrink-0"
      aria-hidden
    />
  );
}

function AccountAvatar({ iconPath }: { iconPath?: string }) {
  const [failed, setFailed] = useState(false);
  if (!iconPath || failed) {
    return (
      <div
        aria-hidden
        className="bg-muted-foreground/40 size-8 shrink-0 rounded-full"
      />
    );
  }
  return (
    <Image
      src={`${BUNGIE_IMAGE_BASE}${iconPath}`}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded-full object-cover"
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}

function manifestCopy(status: ReturnType<typeof useManifest>): string {
  if (status.state === "ready") return `Manifest ${status.manifest.version} ready.`;
  if (status.state === "loading") return status.message;
  if (status.state === "error") return `Couldn't load manifest: ${status.message}`;
  return "Waiting to load the Destiny manifest…";
}

/**
 * Figma 18:6505 — Your armor, game data, and the signed-in account, pinned
 * at the bottom of the sidebar.
 */
export function ArmoryStatus() {
  const session = useSession();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching, refetch } = useArmory();
  const manifestStatus = useManifest();
  const [refreshSucceeded, setRefreshSucceeded] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    },
    [],
  );

  const handleRefresh = async () => {
    setRefreshSucceeded(false);
    const result = await refetch();
    if (!result.isSuccess) return;

    void queryClient.invalidateQueries({ queryKey: ["armory-diagnostics-counts"] });

    setRefreshSucceeded(true);
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = setTimeout(
      () => setRefreshSucceeded(false),
      REFRESH_SUCCESS_MS,
    );
  };

  const handleSignOut = async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" }).catch(
      () => null,
    );
    if (!res?.ok) {
      toast.error("Sign out failed. Please try again.");
      return;
    }
    window.location.assign("/");
  };

  if (!session.data?.authenticated) return null;

  const pieces = data?.pieces ?? [];
  const exotics = pieces.filter((p) => p.isExotic).length;
  const armorState = isLoading ? "loading" : isError ? "error" : data ? "ready" : "idle";
  const displayName = session.data.user?.displayName ?? "Bungie account";

  return (
    <section
      aria-label="Account and game data"
      className="border-border bg-primary/6 flex w-full flex-col overflow-hidden rounded-2xl border"
    >
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <StatusIcon state={armorState} />
          <h2 className="min-w-0 flex-1 text-sm font-medium">Your armor</h2>
          <Button
            size="xs"
            disabled={isFetching || refreshSucceeded}
            onClick={() => void handleRefresh()}
          >
            {isFetching ? (
              <CircleNotch weight="duotone" className="animate-spin" aria-hidden />
            ) : refreshSucceeded ? (
              <CheckCircle weight="duotone" className="text-emerald-500" aria-hidden />
            ) : (
              <ArrowsCounterClockwise weight="duotone" aria-hidden />
            )}
            {isFetching ? "Refreshing…" : refreshSucceeded ? "Refreshed" : "Refresh gear"}
          </Button>
        </div>
        <p className="text-muted-foreground flex flex-wrap gap-x-4 text-sm tabular-nums">
          {isLoading && "Loading your Guardians' gear…"}
          {isError &&
            `Couldn't load inventory: ${(error as Error)?.message ?? "unknown error"}`}
          {data && (
            <>
              <span>{pieces.length} armor pieces</span>
              <span>{exotics} exotics</span>
            </>
          )}
        </p>
        {!isLoading && <ArmoryDiagnosticsGate />}
      </div>

      <div className="bg-border h-px" />

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <StatusIcon state={manifestStatus.state} />
          <h2 className="text-sm font-medium">Game data</h2>
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {manifestCopy(manifestStatus)}
        </p>
      </div>

      <div className="bg-border h-px" />

      <div className="flex h-[76px] items-center justify-between overflow-hidden p-3">
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar iconPath={session.data.user?.iconPath} />
          <p className="truncate text-sm font-medium">{displayName}</p>
        </div>
        <TooltipLabel label="Sign out">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sign out"
            onClick={() => void handleSignOut()}
          >
            <SignOut className="size-4" aria-hidden />
          </Button>
        </TooltipLabel>
      </div>
    </section>
  );
}
