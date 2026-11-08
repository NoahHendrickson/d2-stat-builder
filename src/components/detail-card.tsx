"use client";

import { useId, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A card holding one or more titled sections. */
export function DetailCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    // A visible hairline round the card and a fainter shadow than Card's own.
    <Card
      size="sm"
      className={cn(
        "gap-4 border-foreground/12 shadow-[0_0_4px_rgb(0_0_0/0.2)]",
        className,
      )}
    >
      {children}
    </Card>
  );
}

/**
 * The section frame both kinds share. A section after the first opens with a
 * divider of its own, edge to edge. The header ends in a plain divider in the
 * border's colour, under the title and any description, running out through
 * the padding to the card's edges; a closed section has nothing under its
 * header, so it goes without, and pulls the card's padding in so its title
 * sits as centred as an open one's. A section with no body (a card's heading)
 * goes without its rule too: the next section opens with its own.
 */
function SectionFrame({
  title,
  open,
  heading,
  action,
  description,
  contentId,
  children,
}: {
  title: string;
  open: boolean;
  heading: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  contentId?: string;
  children?: ReactNode;
}) {
  const body = open && children != null;
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-(--card-spacing) not-first:border-t not-first:border-foreground/12 not-first:pt-2",
        !open && "-mb-1",
      )}
    >
      <CardHeader
        className={cn(
          "relative",
          body && "pb-2 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-foreground/12",
        )}
      >
        {/* The rule is the header's, below the description, not the title's. */}
        <CardTitle className="self-center pb-0 after:hidden">{heading}</CardTitle>
        {action && <CardAction className="row-span-1 self-center">{action}</CardAction>}
        {open && description && (
          <CardDescription className="col-span-full text-xs leading-snug">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      {body && <CardContent id={contentId}>{children}</CardContent>}
    </section>
  );
}

/**
 * One part of a card under its
 * title, with an optional control at the title's right end and a description
 * under it. Without children it's just a heading, as at the top of a card.
 */
export function DetailSection({
  title,
  heading = title,
  action,
  description,
  children,
}: {
  /** The section's accessible name. */
  title: string;
  /** What the header shows (an element of its own, say a heading), when not just `title`. */
  heading?: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SectionFrame title={title} open heading={heading} action={action} description={description}>
      {children}
    </SectionFrame>
  );
}

/**
 * A section whose title opens and closes it; it starts closed, and its
 * description shows only while it's open.
 */
export function CollapsibleDetailSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <SectionFrame
      title={title}
      open={open}
      contentId={contentId}
      description={description}
      heading={
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((o) => !o)}
          className="group/toggle flex w-full items-center justify-between gap-2 text-left outline-none focus-visible:d2-tile-selected"
        >
          {title}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground transition-transform group-hover/toggle:text-foreground motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      }
    >
      {children}
    </SectionFrame>
  );
}
