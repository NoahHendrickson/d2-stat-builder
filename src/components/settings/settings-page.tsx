"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme } from "next-themes";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SITE_ICONS, setSiteIcon, useSiteIcon } from "@/lib/site-icon";
import { THEME_OPTIONS } from "@/lib/theme-options";
import { cn } from "@/lib/utils";

/** Appearance and site icon, both kept per device. */
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
              "d2-hover-ring size-12 shrink-0 rounded-none outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-outline-strong",
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
