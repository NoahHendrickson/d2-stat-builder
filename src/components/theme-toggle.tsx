"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useSyncExternalStore } from "react";
import { Moon, Sun, Swatches } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { SKIN_LABELS } from "@/lib/skin";
import { useSkin } from "@/lib/use-skin";

const noopSubscribe = () => () => {};

/** True after hydration; the server snapshot is false so SSR and the first client render agree. */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <TooltipLabel label="Toggle color theme">
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Toggle color theme"
          disabled
        >
          <Sun weight="duotone" className="size-4" />
        </Button>
      </TooltipLabel>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <TooltipLabel
      label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => setTheme(isDark ? "light" : "dark")}
      >
        <Sun
          weight="duotone"
          className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90"
        />
        <Moon
          weight="duotone"
          className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0"
        />
      </Button>
    </TooltipLabel>
  );
}

/**
 * Flips between the classic chrome and the Destiny 2 look. Sits beside the
 * light/dark toggle; the two are independent (see src/lib/skin.ts).
 */
export function SkinToggle() {
  const { skin, setSkin } = useSkin();
  const hydrated = useHydrated();
  const next = skin === "d2" ? "classic" : "d2";
  const label = `Switch to the ${SKIN_LABELS[next]} look`;

  return (
    <TooltipLabel label={hydrated ? label : "Toggle look"}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={hydrated ? label : "Toggle look"}
        aria-pressed={hydrated ? skin === "d2" : undefined}
        disabled={!hydrated}
        onClick={() => setSkin(next)}
      >
        <Swatches weight="duotone" className="size-4" />
      </Button>
    </TooltipLabel>
  );
}
