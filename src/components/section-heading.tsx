import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A section header: a sentence-case title, optional trailing slot. */
export function SectionHeading({
  children,
  trailing,
  as: Tag = "h3",
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  as?: "h2" | "h3" | "h4" | "div";
  className?: string;
}) {
  if (trailing == null) {
    return (
      <Tag className={cn("text-sm font-medium", className)}>{children}</Tag>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Tag className="text-sm font-medium">{children}</Tag>
      <span className="flex shrink-0 items-center">{trailing}</span>
    </div>
  );
}
