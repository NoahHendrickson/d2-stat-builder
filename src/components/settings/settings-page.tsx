"use client";

import { useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_THEMES, setAppTheme, useAppTheme, type AppThemeId } from "@/lib/app-theme";
import { SITE_ICONS, setSiteIcon, useSiteIcon } from "@/lib/site-icon";
import { THEME_OPTIONS } from "@/lib/theme-options";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { buildUsageKey, clearBuildUsage } from "@/lib/build-usage/use-build-usage";
import {
  setBuildUsageRecording,
  useBuildUsageRecording,
} from "@/lib/build-usage/recording-pref";
import { BUILD_USAGE_PAUSED } from "@/lib/build-usage/paused";

/** Appearance, theme, site icon, and armor usage recording, all kept per device. */
export function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 lg:px-6">
      <section aria-labelledby="settings-appearance" className="flex flex-col gap-3">
        <h2 id="settings-appearance" className="d2-label">
          Appearance
        </h2>
        <AppearancePicker />
      </section>
      <div className="d2-rule" />
      <section aria-labelledby="settings-theme" className="flex flex-col gap-3">
        <h2 id="settings-theme" className="d2-label">
          Theme
        </h2>
        <AppThemePicker />
      </section>
      <div className="d2-rule" />
      <section aria-labelledby="settings-site-icon" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="settings-site-icon" className="d2-label">
            Site icon
          </h2>
          <p className="text-muted-foreground text-sm">
            Shown in your browser tab and at the top of the sidebar.
          </p>
        </div>
        <SiteIconPicker />
      </section>
      {!BUILD_USAGE_PAUSED && (
        <>
          <div className="d2-rule" />
          <section aria-labelledby="settings-armor-usage" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="settings-armor-usage" className="d2-label">
                Armor usage history
              </h2>
              <p className="text-muted-foreground text-sm">
                Optimizer searches you stop on are saved to your account, so the Searches column
                and Cleanup on Armor can show which pieces never make a build.
              </p>
            </div>
            <ArmorUsageSettings />
          </section>
        </>
      )}
    </main>
  );
}

function AppearancePicker() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored theme after mount.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <Tabs value={mounted ? (theme ?? "dark") : null} onValueChange={(v) => setTheme(String(v))}>
      <TabsList aria-label="Appearance">
        {THEME_OPTIONS.map((o) => (
          <TabsTrigger key={o.value} value={o.value}>
            <HugeiconsIcon icon={o.icon} aria-hidden />
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

const THEME_SWATCH: Record<AppThemeId, string> = {
  scene: "bg-[url(/backdrop-blur.webp)] bg-cover bg-center",
  slate: "bg-(image:--slate-gradient)",
  // A rounded card on the flat page.
  normal: "bg-[#191b1d] p-3",
};

function AppThemePicker() {
  const current = useAppTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-3">
      {APP_THEMES.map((b) => {
        const selected = b.id === current;
        return (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setAppTheme(b.id)}
            className="group flex flex-col items-start gap-2 outline-none"
          >
            <span
              aria-hidden
              className={cn(
                "d2-hover-ring block h-20 w-32 transition-[box-shadow,outline-offset] normal:rounded-[12px] group-focus-visible:ring-1 group-focus-visible:ring-outline-strong",
                THEME_SWATCH[b.id],
                selected && "d2-tile-selected",
              )}
            >
              {b.id === "normal" && (
                <span className="block size-full rounded-[6px] border border-white/12 bg-white/4" />
              )}
            </span>
            <span className={cn("text-sm", !selected && "text-muted-foreground")}>{b.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SiteIconPicker() {
  const current = useSiteIcon();
  return (
    <div role="radiogroup" aria-label="Site icon" className="flex flex-wrap gap-3">
      {SITE_ICONS.map((icon, i) => {
        const selected = icon.id === current.id;
        return (
          <button
            key={icon.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Icon ${i + 1}`}
            onClick={() => setSiteIcon(icon.id)}
            className={cn(
              "d2-hover-ring size-12 shrink-0 rounded-none outline-none transition-[box-shadow,outline-offset] focus-visible:ring-1 focus-visible:ring-outline-strong",
              selected && "d2-tile-selected",
            )}
          >
            <Image
              src={icon.src}
              alt=""
              width={48}
              height={48}
              className="size-12 [image-rendering:pixelated]"
              unoptimized
            />
          </button>
        );
      })}
    </div>
  );
}

function ArmorUsageSettings() {
  const recording = useBuildUsageRecording();
  const membershipId = sessionMembershipId(useSession().data);
  const queryClient = useQueryClient();
  const [clearing, setClearing] = useState(false);

  const clear = async () => {
    setClearing(true);
    try {
      if (!(await clearBuildUsage())) throw new Error("Clear failed");
      await queryClient.invalidateQueries({ queryKey: buildUsageKey(membershipId) });
      toast.success("Armor usage history cleared");
    } catch {
      toast.error("Couldn't clear the history", "Try again in a moment.");
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={recording} onCheckedChange={setBuildUsageRecording} />
        Record searches on this device
      </label>
      <Button
        type="button"
        variant="outline"
        disabled={!membershipId || clearing}
        onClick={() => void clear()}
      >
        Clear history
      </Button>
    </div>
  );
}
