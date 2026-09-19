"use client";

import { useId, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Figma 100:2746 checked well: greeny wash at 12% with the #5fd05d/16 line. */
const checkedWell =
  "border-[rgb(95_208_93/0.16)] bg-[linear-gradient(to_right,rgb(84_197_95/0.12),rgb(55_139_63/0.12))]";
/** Figma 100:2774 idle well: white/2 fill, white/8 line. */
const idleWell = "border-foreground/8 bg-foreground/[0.02]";

/**
 * A settings card: checkbox + title + description (Figma Advanced / Underlight
 * rows). Checked rows take the green wash; rows without a checkbox stay idle
 * and hold extra controls in `children`.
 */
export function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
  checkbox = false,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  checkbox?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const selected = checkbox && checked === true;
  const body = (
    <>
      <span className="block text-sm font-medium">{title}</span>
      {description != null && (
        <span
          className={cn(
            "mt-0.5 block text-sm",
            selected ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      )}
    </>
  );

  return (
    <div
      className={cn(
        "flex items-start gap-3 border p-3",
        selected ? checkedWell : idleWell,
        className,
      )}
    >
      {checkbox && (
        <div className="flex shrink-0 items-center py-0.5">
          <Checkbox
            id={id}
            checked={checked}
            onCheckedChange={(value) => onCheckedChange?.(value === true)}
            aria-label={title}
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {checkbox ? (
          <label htmlFor={id} className="cursor-pointer">
            {body}
          </label>
        ) : (
          <div>{body}</div>
        )}
        {children != null && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </div>
  );
}
