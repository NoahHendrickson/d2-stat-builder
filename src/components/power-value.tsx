import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The game's Power readout: the cyan diamond glyph beside a tabular number
 * ("◆ 1800"). `size` scales the type; the glyph follows via `em`.
 */
export function PowerValue({
  value,
  size = "sm",
  muted = false,
  className,
  ...props
}: {
  value: number | string;
  size?: "xs" | "sm" | "lg" | "xl";
  /** Grey instead of cyan — for secondary readouts. */
  muted?: boolean;
} & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-[0.3em] font-medium tabular-nums whitespace-nowrap",
        muted ? "text-muted-foreground" : "text-power",
        size === "xs" && "text-[11px]",
        size === "sm" && "text-sm",
        size === "lg" && "text-xl",
        size === "xl" && "text-4xl leading-none",
        className,
      )}
      {...props}
    >
      <PowerGlyph />
      {value}
    </span>
  );
}

/** The ◆ Power diamond, drawn so it stays crisp at every size. */
export function PowerGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn("inline-block size-[0.55em] shrink-0 translate-y-[-0.05em]", className)}
      fill="currentColor"
    >
      <path d="M5 0 10 5 5 10 0 5Z" />
    </svg>
  );
}
