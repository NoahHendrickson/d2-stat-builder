"use client";

import { TooltipLabel } from "@/components/ui/tooltip";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SlidersHorizontal, Table } from "@phosphor-icons/react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const VIEWS = [
  { href: "/", label: "Optimizer", Icon: SlidersHorizontal },
  { href: "/armor", label: "Armor table", Icon: Table },
] as const;

/**
 * Figma "IconTabList" (1:229): the two-way switch between the optimizer and the
 * armor table. Route-based so each view keeps its own URL.
 */
export function ViewTabs({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const value = VIEWS.find((v) => v.href === pathname)?.href ?? "/";

  return (
    <Tabs value={value}>
      <TabsList variant="icon" aria-label="View">
        {VIEWS.map(({ href, label, Icon }) => (
          <TooltipLabel label={label} key={href}>
            <TabsTrigger
              key={href}
              value={href}
              nativeButton={false}
              aria-label={label}
              render={(props) => (
                <Link {...props} href={href} onClick={onNavigate} />
              )}
            >
              <Icon weight="duotone" aria-hidden />
            </TabsTrigger>
          </TooltipLabel>
        ))}
      </TabsList>
    </Tabs>
  );
}
