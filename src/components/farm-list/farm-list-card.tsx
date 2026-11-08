"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ShoppingCart02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetailCard, DetailSection } from "@/components/detail-card";
import { isFarmDone, type FarmEntry } from "@/lib/farm-list/types";
import { cn } from "@/lib/utils";

export const farmDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

type FarmFilter = "all" | "waiting" | "obtained";

const FILTER_EMPTY: Record<Exclude<FarmFilter, "all">, string> = {
  waiting: "Nothing waiting.",
  obtained: "Nothing obtained yet.",
};

/**
 * One half of the page, armor or weapons, in Weapon search's card: new drops, then what's
 * still waiting, then the record of what's been kept. The header's filter narrows it to
 * what's waiting or what's been obtained.
 */
export function FarmPanel<E extends FarmEntry>({
  title,
  entries,
  empty,
  renderCard,
}: {
  title: string;
  entries: E[];
  /** Shown when nothing's been added. */
  empty: ReactNode;
  renderCard: (entry: E) => ReactNode;
}) {
  const [filter, setFilter] = useState<FarmFilter>("all");
  const dropped = entries.filter((e) => e.obtained && !isFarmDone(e));
  const waiting = entries.filter((e) => !e.obtained);
  const kept = entries.filter(isFarmDone).sort((x, y) => y.obtained!.doneAt! - x.obtained!.doneAt!);
  const groups = [
    { title: "Dropped", list: filter === "waiting" ? [] : dropped },
    { title: "Waiting", list: filter === "obtained" ? [] : waiting },
    { title: "Obtained", list: filter === "waiting" ? [] : kept },
  ];
  const shown = groups.some((g) => g.list.length > 0);
  return (
    <DetailCard className="min-w-0 pt-[7px]">
      <DetailSection
        title={title}
        heading={
          // As tall as the filter, so an empty panel's header lines up with a full one's.
          <span className="flex min-h-[38px] items-center">
            <span className="flex items-baseline gap-2">
              {title}
              {entries.length > 0 && (
                <span className="text-muted-foreground text-xs font-normal tabular-nums">{entries.length}</span>
              )}
            </span>
          </span>
        }
        action={
          entries.length > 0 && (
            <Tabs value={filter} onValueChange={(v) => setFilter(v as FarmFilter)}>
              <TabsList aria-label={`Filter ${title.toLowerCase()}`}>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="waiting">Waiting</TabsTrigger>
                <TabsTrigger value="obtained">Obtained</TabsTrigger>
              </TabsList>
            </Tabs>
          )
        }
      >
        {entries.length === 0 ? (
          empty
        ) : shown ? (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <FarmGroup key={g.title} title={g.title} count={g.list.length}>
                {g.list.map(renderCard)}
              </FarmGroup>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{FILTER_EMPTY[filter as keyof typeof FILTER_EMPTY]}</p>
        )}
      </DetailSection>
    </DetailCard>
  );
}

/** A panel with nothing in it yet: what goes here, and a way to go and add some. */
export function FarmEmpty({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: ReactNode;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-14 text-center">
      <span className="flex size-12 items-center justify-center border border-foreground/10 bg-foreground/5 normal:rounded-[14px]">
        <HugeiconsIcon icon={ShoppingCart02Icon} className="size-6 text-muted-foreground" aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h3 className="text-base font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      <Button variant="outline" render={<Link href={href} />} nativeButton={false}>
        {action}
      </Button>
    </div>
  );
}

/** The dot beside each group's name: cyan like a New tag, a soft white, and green. */
const GROUP_DOT: Record<string, string> = {
  Dropped: "bg-power",
  Waiting: "bg-foreground/60",
  Obtained: "bg-positive",
};

/** A list of item cards under a strip that opens and closes it; starts open. */
function FarmGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  if (count === 0) return null;
  return (
    <div data-group={title.toLowerCase()} className="flex flex-col gap-2">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="group/toggle d2-hover-ring flex h-9 w-full items-center gap-2 border border-foreground/10 bg-foreground/8 px-3 text-left transition-colors outline-none hover:bg-foreground/12 focus-visible:d2-tile-selected normal:rounded-[10px]"
        >
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", GROUP_DOT[title])} />
          <span className="d2-label">{title}</span>
          <span className="d2-label text-muted-foreground tabular-nums">{count}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "ml-auto size-4 text-muted-foreground transition-transform group-hover/toggle:text-foreground motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
      </h3>
      {open && (
        <ul id={listId} className="flex flex-col gap-2">
          {children}
        </ul>
      )}
    </div>
  );
}

/** One thing being hunted: its art, name and status, what's being asked for, and its actions. */
export function FarmCard({
  id,
  thumb,
  title,
  isNew,
  status,
  actions,
  children,
}: {
  id: string;
  thumb: ReactNode;
  title: ReactNode;
  isNew: boolean;
  status: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <li data-entry={id} className="flex flex-col gap-3 border border-foreground/10 bg-foreground/5 p-3 normal:rounded-[14px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          {thumb}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5 text-sm">{title}</span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              {isNew && <span className="d2-label text-power">New</span>}
              <span className="truncate" title={status}>
                {status}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-3">{children}</div>
    </li>
  );
}

/** A part of what's being asked for, labelled where its value doesn't say what it is ("Tertiary"). */
export function FarmField({ label, column, children }: { label?: string; column: string; children: ReactNode }) {
  return (
    <div data-column={column} className="flex min-w-0 flex-col gap-1 text-sm">
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
      {children}
    </div>
  );
}
