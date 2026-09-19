import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The game's Power readout: the light-level diamond beside a tabular number
 * ("◆ 1800"). `size` scales the type; the glyph follows via `em`.
 */
export function PowerValue({
  value,
  size = "sm",
  muted = false,
  tone = "cyan",
  className,
  ...props
}: {
  value: number | string;
  size?: "xs" | "sm" | "lg" | "xl";
  /** Grey instead of cyan — for secondary readouts. */
  muted?: boolean;
  /** Figma 86:862 / 86:894 uses Destiny's gold light-level, not the cyan power token. */
  tone?: "cyan" | "gold";
} & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-[0.3em] font-medium tabular-nums whitespace-nowrap",
        muted
          ? "text-muted-foreground"
          : tone === "gold"
            ? "text-power-gold"
            : "text-power",
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

/** Destiny's hollow light-level diamond, drawn so it stays crisp at every size. */
export function PowerGlyph({ className }: { className?: string }) {
  return (
    <svg
      width="6"
      height="6"
      viewBox="0 0 6 6"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={cn("inline-block size-[0.55em] shrink-0 translate-y-[-0.05em]", className)}
    >
      <path
        d="M4.27246 1.72754L6 3L4.27246 4.27246L3 6L1.72754 4.27246L0 3L1.72754 1.72754L3 0L4.27246 1.72754ZM2.54199 2.54199L1.91992 3L2.54199 3.45801L3 4.08008L3.45801 3.45801L4.08008 3L3.45801 2.54199L3 1.91992L2.54199 2.54199Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
