import type { ReactNode } from "react";

/**
 * Tooltip body for a mod, perk or subclass plug: the name (plus what kind of plug it
 * is), any stat line, then what it does. `children` adds a closing line, such as why
 * a perk can't be picked.
 */
export function PlugTooltip({
  name,
  suffix,
  stats,
  description,
  children,
}: {
  name: string;
  suffix?: string;
  stats?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <span className="flex max-w-64 flex-col gap-1">
      <span>
        <span className="font-medium">{name}</span>
        {suffix && <span className="text-muted-foreground"> — {suffix}</span>}
      </span>
      {stats && <span>{stats}</span>}
      {description && <span className="text-muted-foreground">{description}</span>}
      {children}
    </span>
  );
}
