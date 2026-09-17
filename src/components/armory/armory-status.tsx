"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { SkinToggle, ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

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
        className="size-4 shrink-0 text-emerald-500 d2:text-positive"
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

function RefreshIcon({
  isFetching,
  refreshSucceeded,
}: {
  isFetching: boolean;
  refreshSucceeded: boolean;
}) {
  if (isFetching) {
    return <CircleNotch weight="duotone" className="animate-spin" aria-hidden />;
  }
  if (refreshSucceeded) {
    return <CheckCircle weight="duotone" className="text-emerald-500 d2:text-positive" aria-hidden />;
  }
  return <ArrowsCounterClockwise weight="duotone" aria-hidden />;
}

function useArmoryAccount() {
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

  const pieces = data?.pieces ?? [];
  const refreshLabel = isFetching
    ? "Refreshing…"
    : refreshSucceeded
      ? "Refreshed"
      : "Refresh gear";

  return {
    authed: session.data?.authenticated ?? false,
    data,
    isLoading,
    isError,
    error,
    isFetching,
    manifestStatus,
    refreshSucceeded,
    handleRefresh,
    handleSignOut,
    pieces,
    exotics: pieces.filter((p) => p.isExotic).length,
    armorState: (isLoading
      ? "loading"
      : isError
        ? "error"
        : data
          ? "ready"
          : "idle") as "ready" | "loading" | "error" | "idle",
    displayName: session.data?.user?.displayName ?? "Bungie account",
    iconPath: session.data?.user?.iconPath,
    refreshLabel,
  };
}

type ArmoryAccount = ReturnType<typeof useArmoryAccount>;

function ArmorColumn({
  account,
  layout,
}: {
  account: ArmoryAccount;
  layout: "toolbar" | "stacked";
}) {
  const compact = layout === "toolbar";
  const {
    isLoading,
    isError,
    error,
    data,
    pieces,
    exotics,
    armorState,
    isFetching,
    refreshSucceeded,
    handleRefresh,
    refreshLabel,
  } = account;

  const refresh = compact ? (
    <TooltipLabel label={refreshLabel}>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={isFetching || refreshSucceeded}
        aria-label={refreshLabel}
        onClick={() => void handleRefresh()}
      >
        <RefreshIcon isFetching={isFetching} refreshSucceeded={refreshSucceeded} />
      </Button>
    </TooltipLabel>
  ) : (
    <Button
      size="xs"
      disabled={isFetching || refreshSucceeded}
      onClick={() => void handleRefresh()}
    >
      <RefreshIcon isFetching={isFetching} refreshSucceeded={refreshSucceeded} />
      {refreshLabel}
    </Button>
  );

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col",
        compact && "sm:w-[204px] sm:shrink-0",
        !compact && "gap-2",
      )}
    >
      <div className={cn("flex items-center gap-2", compact && "h-6")}>
        <StatusIcon state={armorState} />
        <h2
          className={cn(
            "min-w-0 text-sm font-medium",
            compact ? "flex-1 truncate" : "flex-1",
          )}
        >
          Your armor
        </h2>
        {refresh}
      </div>
      <p
        className={cn(
          "text-muted-foreground text-sm tabular-nums",
          compact
            ? "flex h-5 items-center gap-4"
            : "flex flex-wrap gap-x-4",
        )}
      >
        {isLoading && (compact ? "Loading…" : "Loading your Guardians' gear…")}
        {isError &&
          (compact
            ? ((error as Error)?.message ?? "Couldn't load inventory")
            : `Couldn't load inventory: ${(error as Error)?.message ?? "unknown error"}`)}
        {data && (
          <>
            <span className={compact ? "truncate" : undefined}>
              {pieces.length} armor pieces
            </span>
            <span className={compact ? "hidden shrink-0 sm:inline" : undefined}>
              {exotics} exotics
            </span>
          </>
        )}
      </p>
      {!compact && !isLoading && <ArmoryDiagnosticsGate />}
    </div>
  );
}

function GameDataColumn({
  account,
  layout,
}: {
  account: ArmoryAccount;
  layout: "toolbar" | "stacked";
}) {
  const compact = layout === "toolbar";
  return (
    <div
      className={cn(
        "min-w-0 flex-col gap-2",
        compact ? "hidden xl:flex xl:w-[232px] xl:shrink-0 xl:gap-0" : "flex",
      )}
    >
      <div className={cn("flex items-center gap-2", compact && "h-5")}>
        <StatusIcon state={account.manifestStatus.state} />
        <h2 className="text-sm font-medium">Game data</h2>
      </div>
      <p
        className={cn(
          "text-muted-foreground truncate text-sm",
          compact && "h-5",
        )}
      >
        {manifestCopy(account.manifestStatus)}
      </p>
    </div>
  );
}

function AccountColumn({
  account,
  layout,
}: {
  account: ArmoryAccount;
  layout: "toolbar" | "stacked";
}) {
  const compact = layout === "toolbar";
  const signOut = (
    <TooltipLabel label="Sign out">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={() => void account.handleSignOut()}
      >
        <SignOut className="size-4" aria-hidden />
      </Button>
    </TooltipLabel>
  );
  return (
    <div
      className={cn(
        "flex items-center",
        compact ? "shrink-0 gap-4" : "h-[76px] justify-between overflow-hidden p-3",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AccountAvatar iconPath={account.iconPath} />
        <p
          className={cn(
            "truncate text-sm font-medium",
            compact && "hidden md:block",
          )}
        >
          {account.displayName}
        </p>
      </div>
      {compact ? signOut : <div className="flex shrink-0 items-center">{signOut}</div>}
    </div>
  );
}

function ToolbarDivider() {
  return <div className="hidden h-7 w-px shrink-0 bg-border xl:block d2:h-8 d2:bg-foreground/15" aria-hidden />;
}

function Columns({
  account,
  layout,
  trailing,
}: {
  account: ArmoryAccount;
  layout: "toolbar" | "stacked";
  trailing?: ReactNode;
}) {
  const compact = layout === "toolbar";
  const divider = compact ? <ToolbarDivider /> : <div className="h-px bg-border d2:bg-foreground/15" />;
  return (
    <>
      <ArmorColumn account={account} layout={layout} />
      {divider}
      <GameDataColumn account={account} layout={layout} />
      {divider}
      <AccountColumn account={account} layout={layout} />
      {trailing}
    </>
  );
}

/**
 * Armor / game-data / account cluster. `toolbar` is the desktop header (Figma
 * 46:2947); `stacked` is the mobile card (Figma 18:6505).
 */
export function ArmoryStatus({
  variant = "stacked",
}: {
  variant?: "toolbar" | "stacked";
}) {
  const account = useArmoryAccount();

  if (variant === "toolbar") {
    return (
      <div className="flex min-w-0 items-center gap-4">
        {account.authed && (
          <Columns
            account={account}
            layout="toolbar"
            trailing={<ToolbarDivider />}
          />
        )}
        <SkinToggle />
        <ThemeToggle />
      </div>
    );
  }

  if (!account.authed) return null;

  return (
    <section
      aria-label="Account and game data"
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-primary/6 d2:rounded-none d2:border-foreground/8 d2:bg-lifted d2:shadow-raised"
    >
      <div className="flex flex-col gap-2 p-3">
        <ArmorColumn account={account} layout="stacked" />
      </div>
      <div className="h-px bg-border d2:bg-foreground/15" />
      <div className="flex flex-col gap-2 p-3">
        <GameDataColumn account={account} layout="stacked" />
      </div>
      <div className="h-px bg-border d2:bg-foreground/15" />
      <AccountColumn account={account} layout="stacked" />
    </section>
  );
}
