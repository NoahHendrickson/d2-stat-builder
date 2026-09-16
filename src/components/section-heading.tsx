import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A section header: a sentence-case title, an optional muted detail after a
 * "//" separator (the game's section-tag convention, kept quiet), a hairline
 * that runs out to the right, and an optional trailing slot (a count, a
 * control).
 */
export function SectionHeading({
  children,
  detail,
  trailing,
  as: Tag = "h3",
  className,
}: {
  children: ReactNode;
  /** Secondary text after a "//" separator. */
  detail?: ReactNode;
  trailing?: ReactNode;
  as?: "h2" | "h3" | "h4" | "div";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Tag className="flex shrink-0 items-baseline gap-2 text-sm font-medium">
        <span>{children}</span>
        {detail != null && (
          <span className="text-muted-foreground text-xs">
            <span aria-hidden>{"// "}</span>
            {detail}
          </span>
        )}
      </Tag>
      <span className="d2-rule min-w-4 flex-1" aria-hidden />
      {trailing != null && <span className="flex shrink-0 items-center">{trailing}</span>}
    </div>
  );
}
