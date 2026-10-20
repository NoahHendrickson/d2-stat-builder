"use client";

import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { ArmorThumb } from "@/components/armor-thumb";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BUCKET_LABELS,
  BUCKETS,
  bucketView,
  type ActivityBucket,
  type BucketView,
} from "@/lib/armory/set-popularity";
import { setSlotIcons, type SetSlotIcon } from "@/lib/armory/sets";
import { useSetPopularity } from "@/lib/armory/use-set-popularity";
import type { Manifest } from "@/lib/manifest/load";

/** Below this many players a bucket's shares swing on a handful of loadouts, so it isn't shown. */
const MIN_SAMPLES = 30;
/** Sets listed before "Show all". */
const SETS_SHOWN = 10;
/** 2 + 2 pairs listed. */
const PAIRS_SHOWN = 5;

// With the hour: the snapshot is rebuilt several times a day.
const sampledAt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric" });

/** A share as a whole percent; nobody at all is "0%", a few people "<1%". */
const percent = (share: number) =>
  share === 0 ? "0%" : share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;

/**
 * The set bonuses players wear in raids, dungeons, GM Vanguard Alerts and
 * Conquests (src/lib/armory/set-popularity.ts), one tab each: how their armor
 * splits into 4-piece, 2 + 2, one 2-piece and no bonus, every set worn by how
 * many run its bonuses, and the 2 + 2 pairs run most.
 */
export function SetPopularityDialog({
  open,
  onOpenChange,
  manifest,
  classType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manifest?: Manifest;
  /** Whose armor thumbnails to show; the shares are of every class. */
  classType: number | null;
}) {
  const [bucket, setBucket] = useState<ActivityBucket>("raid");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto p-5 sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Set popularity</DialogTitle>
          <DialogDescription>The set bonuses players wear in endgame activities.</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Tabs value={bucket} onValueChange={(value) => setBucket(value as ActivityBucket)}>
            <TabsList aria-label="Activity">
              {BUCKETS.map((b) => (
                <TabsTrigger key={b} value={b}>
                  {BUCKET_LABELS[b]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {/* Mounted only while open, so the snapshot is fetched on the first open. */}
        <PopularityBody key={bucket} bucket={bucket} manifest={manifest} classType={classType} />
      </DialogContent>
    </Dialog>
  );
}

function PopularityBody({
  bucket,
  manifest,
  classType,
}: {
  bucket: ActivityBucket;
  manifest?: Manifest;
  classType: number | null;
}) {
  const query = useSetPopularity();
  const tally = query.data?.buckets[bucket];
  const view = useMemo(() => (tally ? bucketView(tally) : undefined), [tally]);
  const [showAll, setShowAll] = useState(false);

  if (query.isPending) return <p className="text-muted-foreground text-sm">Loading set popularity…</p>;
  if (!query.data) return <p className="text-muted-foreground text-sm">Set popularity couldn&apos;t be loaded. Try again later.</p>;
  if (!view || view.samples < MIN_SAMPLES) {
    return (
      <p className="text-muted-foreground text-sm">
        Not enough players counted in {BUCKET_LABELS[bucket].toLowerCase()} yet
        {view ? ` (${view.samples} so far)` : ""}. Check back in a day or two.
      </p>
    );
  }

  const name = (setHash: number) =>
    manifest?.def("DestinyEquipableItemSetDefinition", setHash)?.displayProperties?.name ?? "Unknown set";
  const helmet = (setHash: number) => (manifest ? setLook(manifest, setHash, classType) : undefined);
  const sets = showAll ? view.sets : view.sets.slice(0, SETS_SHOWN);
  const widest = view.sets[0]?.any || 1;

  return (
    <div className="flex flex-col gap-5">
      <Setups view={view} />

      <section className="flex flex-col gap-2" aria-label="Sets">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] max-sm:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] gap-x-3 text-xs">
          <span>Set</span>
          <span className="text-right">4-piece</span>
          <span className="text-right">2-piece</span>
        </div>
        <ul className="flex flex-col gap-2">
          {sets.map((set) => {
            const look = helmet(set.setHash);
            return (
              <li key={set.setHash} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] max-sm:grid-cols-[minmax(0,1fr)_3.25rem_3.25rem] items-center gap-x-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ArmorThumb icon={look?.icon} watermark={look?.watermark} size={32} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm">{name(set.setHash)}</span>
                    {/* The 4-piece share, then the 2-piece share after it, against the most worn set. */}
                    <div className="bg-foreground/8 flex h-1.5 w-full" aria-hidden>
                      <div className="bg-emphatic h-full" style={{ width: `${(set.four / widest) * 100}%` }} />
                      <div className="bg-emphatic/40 h-full" style={{ width: `${(set.two / widest) * 100}%` }} />
                    </div>
                  </div>
                </div>
                <span className="text-right text-sm tabular-nums">{percent(set.four)}</span>
                <span className="text-right text-sm tabular-nums">{percent(set.two)}</span>
              </li>
            );
          })}
        </ul>
        {view.sets.length > SETS_SHOWN && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="d2-hover-ring bg-foreground/10 h-7 self-start px-2.5 text-xs outline-none focus-visible:d2-tile-selected"
          >
            {showAll ? "Show fewer" : `Show all ${view.sets.length} sets`}
          </button>
        )}
      </section>

      {view.pairs.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="2 + 2 pairs">
          <h3 className="text-muted-foreground text-xs">Top 2 + 2 pairs</h3>
          <ul className="flex flex-col gap-2">
            {view.pairs.slice(0, PAIRS_SHOWN).map(({ sets: [a, b], share }) => {
              const lookA = helmet(a);
              const lookB = helmet(b);
              return (
                <li key={`${a},${b}`} className="flex items-center gap-2">
                  <ArmorThumb icon={lookA?.icon} watermark={lookA?.watermark} size={24} />
                  <ArmorThumb icon={lookB?.icon} watermark={lookB?.watermark} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {name(a)} + {name(b)}
                  </span>
                  <span className="text-sm tabular-nums">{percent(share)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Footnote samples={view.samples} generatedAt={query.data.generatedAt} days={query.data.days} />
    </div>
  );
}

/** How the bucket's armor splits, as four tiles. */
function Setups({ view }: { view: BucketView }) {
  const tiles = [
    { label: "4-piece", share: view.shape.four },
    { label: "2 + 2", share: view.shape.pair },
    { label: "One 2-piece", share: view.shape.two },
    { label: "No set bonus", share: view.shape.none },
  ];
  return (
    <section className="grid grid-cols-4 gap-2 max-sm:grid-cols-2" aria-label="Setups">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-foreground/6 flex flex-col gap-0.5 px-3 py-2">
          <span className="text-lg tabular-nums">{percent(tile.share)}</span>
          <span className="text-muted-foreground text-xs">{tile.label}</span>
        </div>
      ))}
    </section>
  );
}

function Footnote({ samples, generatedAt, days }: { samples: number; generatedAt: string; days: number }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <span>
        {samples.toLocaleString("en-US")} players over the last {days} days, as of{" "}
        {sampledAt.format(new Date(generatedAt))}.
      </span>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <button
              type="button"
              aria-label="How set popularity is worked out"
              className="hover:text-foreground flex size-6 items-center justify-center outline-none focus-visible:d2-tile-selected"
            />
          }
        >
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="grid max-w-72 gap-1.5 text-xs">
          <p>
            We find players through activities that just ended and read the armor they have on while
            they&apos;re in a raid, dungeon, GM Vanguard Alert or Conquest. After an alert or Conquest, a
            read in orbit counts too, if they still have the same weapons.
          </p>
          <p>Each character counts once per activity type, with its latest loadout. Every class counts together.</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** A set's helmet thumbnail for `classType`, or any class's when there's none. */
function setLook(manifest: Manifest, setHash: number, classType: number | null): SetSlotIcon | undefined {
  for (const c of classType === null ? [0, 1, 2] : [classType, 0, 1, 2]) {
    const icons = setSlotIcons(manifest, setHash, c);
    const look = icons.helmet ?? Object.values(icons)[0];
    if (look) return look;
  }
  return undefined;
}
