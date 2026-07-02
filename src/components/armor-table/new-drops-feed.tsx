"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { X } from "@phosphor-icons/react";
import {
  DROPS_SCHEMA_VERSION,
  acknowledge,
  acknowledgeAll,
  feedIds,
  loadDrops,
  reconcileSeen,
  saveDrops,
  type SeenMap,
} from "@/lib/armor-table/drops-storage";
import { formatRelativeTime } from "@/lib/armor-table/relative-time";
import { statLabel } from "@/lib/armor-table/sort";
import { BUNGIE_IMAGE_BASE } from "@/lib/bungie/constants";
import { Button } from "@/components/ui/button";
import type { Row } from "@/components/armor-table/armor-table-row";

// The seen-map lives in a tiny external store (module cache + localStorage
// write-through) rather than component state: reconciliation runs in an
// effect, and effects should update external systems, not call setState —
// React re-renders via the useSyncExternalStore subscription instead.
let seenCache: SeenMap | null | undefined;
const seenListeners = new Set<() => void>();

function getSeenSnapshot(): SeenMap | null {
  if (seenCache === undefined) seenCache = loadDrops()?.seen ?? null;
  return seenCache;
}

function getSeenServerSnapshot(): SeenMap | null {
  return null;
}

function setSeenMap(next: SeenMap) {
  seenCache = next;
  saveDrops({ version: DROPS_SCHEMA_VERSION, seen: next });
  for (const listener of seenListeners) listener();
}

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
}

/**
 * "New drops" panel to the right of the armor table (ported UX from
 * armorset-tracker): armor whose instanceId appeared since the last visit,
 * newest first. Display-only — dismiss per entry, Clear for all. The
 * first-ever visit seeds the seen-store silently so an existing collection
 * doesn't flood the feed. Hidden below xl, where the table already scrolls
 * horizontally.
 */
export function NewDropsFeed({ rows }: { rows: Row[] }) {
  const seen = useSyncExternalStore(
    subscribeSeen,
    getSeenSnapshot,
    getSeenServerSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());

  // Reconcile whenever armor data lands or refetches. Guarding on rows.length
  // keeps a loading/empty armory from seeding — or worse, pruning — anything.
  useEffect(() => {
    if (rows.length === 0) return;
    const stored = getSeenSnapshot();
    const next = reconcileSeen(
      stored,
      rows.map((r) => r.piece.instanceId),
      Date.now(),
    );
    if (next !== stored) setSeenMap(next);
  }, [rows]);

  const entries = useMemo(() => {
    if (!seen) return [];
    const byId = new Map(rows.map((r) => [r.piece.instanceId, r]));
    return feedIds(seen).flatMap(({ id, firstSeen }) => {
      const row = byId.get(id);
      return row ? [{ row, firstSeen }] : [];
    });
  }, [seen, rows]);

  // Keep relative times fresh while anything is showing.
  const hasEntries = entries.length > 0;
  useEffect(() => {
    if (!hasEntries) return;
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, [hasEntries]);

  return (
    <aside
      className="hidden w-56 shrink-0 flex-col gap-2 xl:flex"
      aria-label="New drops"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">
          New drops
          {hasEntries && (
            <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
              {entries.length}
            </span>
          )}
        </h2>
        {hasEntries && seen && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => setSeenMap(acknowledgeAll(seen))}
          >
            Clear
          </Button>
        )}
      </div>
      <div className="border-border/50 min-h-0 flex-1 overflow-y-auto rounded-lg border p-1">
        {!hasEntries ? (
          <p className="text-muted-foreground px-2 py-4 text-center text-xs">
            New armor will appear here.
          </p>
        ) : (
          entries.map(({ row, firstSeen }) => {
            const { piece } = row;
            const subtitle = [
              piece.archetype,
              row.tertiary !== undefined ? statLabel(row.tertiary) : undefined,
              piece.tunedStat !== undefined
                ? `${statLabel(piece.tunedStat)} tuned`
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={piece.instanceId}
                className="group/entry hover:bg-accent flex items-start gap-2 rounded-md p-1.5"
              >
                {piece.icon ? (
                  <Image
                    src={`${BUNGIE_IMAGE_BASE}${piece.icon}`}
                    alt=""
                    width={24}
                    height={24}
                    className="mt-0.5 shrink-0 rounded-sm"
                  />
                ) : (
                  <span
                    className="bg-muted mt-0.5 size-6 shrink-0 rounded-sm"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{piece.name}</p>
                  {subtitle && (
                    <p className="text-muted-foreground truncate text-xs">
                      {subtitle}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {formatRelativeTime(firstSeen, now)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Dismiss ${piece.name}`}
                  onClick={() =>
                    seen && setSeenMap(acknowledge(seen, piece.instanceId))
                  }
                  className="text-muted-foreground hover:text-foreground shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/entry:opacity-100"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
