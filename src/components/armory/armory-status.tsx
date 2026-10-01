"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CloudSavingDone01Icon,
  Loading03Icon,
  Logout01Icon,
  RefreshIcon as RefreshGlyph,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipLabel } from "@/components/ui/tooltip";
import { ArmoryDiagnosticsGate } from "@/components/armory/armory-diagnostics-gate";
import { useArmory } from "@/lib/armory/use-armory";
import { signOut } from "@/lib/auth/sign-out";
import { useSession } from "@/lib/auth/use-session";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { useManifest } from "@/lib/manifest/use-manifest";
import { toast } from "@/lib/toast";
import { THEME_OPTIONS } from "@/lib/theme-options";
import { cn } from "@/lib/utils";

const REFRESH_SUCCESS_MS = 2500;

function StatusIcon({
  state,
}: {
  state: "ready" | "loading" | "error" | "idle";
}) {
  if (state === "loading") {
    return (
      <HugeiconsIcon icon={Loading03Icon}
        className="size-4 shrink-0 animate-spin"
        aria-hidden
      />
    );
  }
  if (state === "error") {
    return (
      <HugeiconsIcon icon={CancelCircleIcon}
        className="text-destructive size-4 shrink-0"
        aria-hidden
      />
    );
  }
  if (state === "ready") {
    return (
      <HugeiconsIcon icon={CloudSavingDone01Icon}
        className="size-4 shrink-0 text-positive"
        aria-hidden
      />
    );
  }
  return (
    <HugeiconsIcon icon={CloudSavingDone01Icon}
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
  if (status.state === "ready") {
    return status.updating
      ? `Manifest ${status.manifest.version} — newer version downloading; new gear may be missing until it finishes.`
      : `Manifest ${status.manifest.version} ready.`;
  }
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
    return <HugeiconsIcon icon={Loading03Icon} className="animate-spin" aria-hidden />;
  }
  if (refreshSucceeded) {
    return <HugeiconsIcon icon={CheckmarkCircle02Icon} className="text-positive" aria-hidden />;
  }
  return <HugeiconsIcon icon={RefreshGlyph} aria-hidden />;
}

function useArmoryAccount() {
  const session = useSession();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching, isProvisional, refetch } =
    useArmory();
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
    if (!(await signOut(queryClient))) {
      toast.error("Sign out failed. Please try again.");
      return;
    }
    window.location.assign("/");
  };

  const pieces = data?.pieces ?? [];
  const refreshLabel = isProvisional
    ? "Refreshing from Bungie…"
    : isFetching
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

function armorSummary(account: ArmoryAccount, long: boolean): string {
  if (account.isLoading) return long ? "Loading your Guardians' gear…" : "Loading…";
  if (account.isError) {
    const message = (account.error as Error)?.message;
    return long
      ? `Couldn't load inventory: ${message ?? "unknown error"}`
      : (message ?? "Couldn't load inventory");
  }
  if (account.data) {
    return `${account.pieces.length} armor pieces · ${account.exotics} exotics`;
  }
  return "";
}

function RefreshButton({
  account,
  label = account.refreshLabel,
  size,
}: {
  account: ArmoryAccount;
  label?: string;
  size: "icon" | "icon-xs";
}) {
  const { isFetching, refreshSucceeded, isError } = account;
  return (
    <TooltipLabel label={label}>
      <Button
        variant="ghost"
        size={size}
        disabled={isFetching || refreshSucceeded}
        aria-label={account.refreshLabel}
        onClick={() => void account.handleRefresh()}
      >
        {/* On the rail this icon is the only armor status, so it shows errors too. */}
        {size === "icon" && isError && !isFetching ? (
          <StatusIcon state="error" />
        ) : (
          <RefreshIcon isFetching={isFetching} refreshSucceeded={refreshSucceeded} />
        )}
      </Button>
    </TooltipLabel>
  );
}

function SignOutButton({ account }: { account: ArmoryAccount }) {
  return (
    <TooltipLabel label="Sign out">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        onClick={() => void account.handleSignOut()}
      >
        <HugeiconsIcon icon={Logout01Icon} className="size-4" aria-hidden />
      </Button>
    </TooltipLabel>
  );
}

/** Mobile card (Figma 18:6505): armor, game data, then the account row. */
export function ArmoryStatus() {
  const account = useArmoryAccount();
  if (!account.authed) return null;

  return (
    <section
      aria-label="Account and game data"
      className="flex w-full flex-col overflow-hidden rounded-none normal:rounded-[12px] border border-foreground/8 bg-lifted shadow-raised"
    >
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <StatusIcon state={account.armorState} />
          <h2 className="min-w-0 flex-1 text-sm font-medium">Your armor</h2>
          <Button
            size="xs"
            disabled={account.isFetching || account.refreshSucceeded}
            onClick={() => void account.handleRefresh()}
          >
            <RefreshIcon
              isFetching={account.isFetching}
              refreshSucceeded={account.refreshSucceeded}
            />
            {account.refreshLabel}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {armorSummary(account, true)}
        </p>
        {!account.isLoading && <ArmoryDiagnosticsGate />}
      </div>
      <div className="h-px bg-foreground/15" />
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <StatusIcon state={account.manifestStatus.state} />
          <h2 className="text-sm font-medium">Game data</h2>
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {manifestCopy(account.manifestStatus)}
        </p>
      </div>
      <div className="h-px bg-foreground/15" />
      <div className="flex h-[76px] items-center justify-between overflow-hidden p-3">
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar iconPath={account.iconPath} />
          <p className="truncate text-sm font-medium">{account.displayName}</p>
        </div>
        <SignOutButton account={account} />
      </div>
    </section>
  );
}

/**
 * The sidebar's foot: your armor (with refresh) above game data above the account
 * row — the profile opens a menu (appearance, sign out) and the gear opens Settings.
 * `collapsed` is the icon rail, where each block is one icon with a tooltip.
 */
export function SidebarStatus({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Called after following the Settings link (the mobile drawer closes itself). */
  onNavigate?: () => void;
}) {
  const account = useArmoryAccount();
  const gameData = manifestCopy(account.manifestStatus);

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-foreground/8 py-3">
        {account.authed && (
          <>
            <RefreshButton
              account={account}
              size="icon"
              label={`Your armor: ${armorSummary(account, false)}\n${account.refreshLabel}`}
            />
            <TooltipLabel label={`Game data: ${gameData}`}>
              <span
                tabIndex={0}
                role="img"
                aria-label={`Game data: ${gameData}`}
                className="flex size-8 items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-outline-strong"
              >
                <StatusIcon state={account.manifestStatus.state} />
              </span>
            </TooltipLabel>
            <AccountMenu account={account} collapsed />
          </>
        )}
        <SettingsLink onNavigate={onNavigate} />
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col border-t border-foreground/8">
      {account.authed && (
        <>
          <section aria-label="Your armor" className="flex flex-col gap-0.5 px-4 py-3">
            <div className="flex h-6 items-center gap-2">
              <StatusIcon state={account.armorState} />
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium">Your armor</h2>
              <RefreshButton account={account} size="icon-xs" />
            </div>
            <p className="text-muted-foreground truncate pl-6 text-xs tabular-nums">
              {armorSummary(account, false)}
            </p>
          </section>
          <div className="mx-4 h-px bg-foreground/8" />
          <section aria-label="Game data" className="flex flex-col gap-0.5 px-4 py-3">
            <div className="flex h-6 items-center gap-2">
              <StatusIcon state={account.manifestStatus.state} />
              <h2 className="text-sm font-medium">Game data</h2>
            </div>
            <p className="text-muted-foreground truncate pl-6 text-xs" title={gameData}>
              {gameData}
            </p>
          </section>
          <div className="mx-4 h-px bg-foreground/8" />
        </>
      )}
      <div className="flex h-16 items-center gap-1 px-2">
        {account.authed ? (
          <AccountMenu account={account} collapsed={false} />
        ) : (
          <div className="flex-1" />
        )}
        <SettingsLink onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function SettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  const active = usePathname() === "/settings";
  return (
    <TooltipLabel label="Settings">
      <Link
        href="/settings"
        onClick={onNavigate}
        aria-label="Settings"
        aria-current={active ? "page" : undefined}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "shrink-0",
          active ? "bg-foreground/8 text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <HugeiconsIcon icon={Settings01Icon} strokeWidth={active ? 2 : 1.5} className="size-5" aria-hidden />
      </Link>
    </TooltipLabel>
  );
}

/**
 * The profile: avatar, name, and a down arrow that opens appearance and sign out.
 * On the rail it is just the avatar, and the menu leads with the name.
 */
function AccountMenu({ account, collapsed }: { account: ArmoryAccount; collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const trigger = collapsed ? (
    <TooltipLabel label={account.displayName}>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-9" />}
        aria-label={`Account: ${account.displayName}`}
      >
        <AccountAvatar iconPath={account.iconPath} />
      </DropdownMenuTrigger>
    </TooltipLabel>
  ) : (
    <DropdownMenuTrigger
      aria-label={`Account: ${account.displayName}`}
      className="group/profile flex h-11 min-w-0 flex-1 items-center gap-2 rounded-none normal:rounded-[8px] px-1.5 text-left outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-outline-strong aria-expanded:bg-foreground/8"
    >
      <AccountAvatar iconPath={account.iconPath} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{account.displayName}</span>
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        className="text-muted-foreground size-4 shrink-0 transition-transform group-aria-expanded/profile:rotate-180"
        aria-hidden
      />
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align={collapsed ? "end" : "start"}
        sideOffset={8}
        className="w-52"
      >
        {collapsed && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{account.displayName}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "dark"} onValueChange={(v) => setTheme(String(v))}>
            {THEME_OPTIONS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                <HugeiconsIcon icon={o.icon} aria-hidden />
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void account.handleSignOut()}>
          <HugeiconsIcon icon={Logout01Icon} aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
