"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
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
