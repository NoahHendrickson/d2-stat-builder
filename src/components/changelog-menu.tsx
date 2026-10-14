"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactElement } from "react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { CHANGELOG } from "@/lib/changelog";
import { seenFlag } from "@/lib/seen-flag";

let isOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The newest entry, once opened: the button's dot goes until a newer one ships. */
const latest = seenFlag("stat-builder:changelog-seen", CHANGELOG[0]?.date ?? "");
let unseen: boolean | null = null;

/** Links from before the Changelog (the old release popup's #whats-new) open it too. */
const HASHES = ["#changelog", "#whats-new"];

function setOpen(open: boolean) {
  if (open === isOpen) return;
  isOpen = open;
  if (open) {
    latest.markSeen();
    unseen = false;
  } else if (HASHES.includes(window.location.hash)) {
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }
  emit();
}

/** Whether there's an entry this browser hasn't opened the Changelog since. */
export function useChangelogUnseen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (unseen ??= !latest.seen()),
    // No dot in the server render: storage is the browser's.
    () => false,
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Oct 14, 2026" from "2026-10-14", without the local time zone moving the day. */
function formatDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

/**
 * The Changelog: a menu off the sidebar's Changelog row, listing every entry in
 * lib/changelog.ts as a card, newest first, scrolling back to the first release. The
 * only place the app announces what's new; it never opens by itself. Its open state
 * lives in this module, so it survives the sidebar re-rendering (collapse, breakpoints).
 */
export function ChangelogMenu({ trigger }: { trigger: ReactElement }) {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false);
  // Focus starts on the list, not its first link (an older release's), so it opens at
  // the top and the arrow keys scroll it.
  const list = useRef<HTMLDivElement>(null);
  // An old #whats-new / #changelog link opens it. Unmounting closes it: the phone drawer
  // that holds the row can close under an open menu, which mustn't reopen with it.
  useEffect(() => {
    if (HASHES.includes(window.location.hash)) setOpen(true);
    return () => setOpen(false);
  }, []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        initialFocus={list}
        className="max-h-[min(var(--available-height),40rem)] w-96 max-w-[calc(100vw-1rem)] gap-0 p-0"
      >
        <PopoverTitle className="border-foreground/10 border-b px-4 py-3 text-base">
          Changelog
        </PopoverTitle>
        <div
          ref={list}
          tabIndex={-1}
          className="d2-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 outline-none"
        >
          {CHANGELOG.map((entry) => (
            // One card per release, framed like the Dream build dialog's cards.
            <section
              key={entry.date}
              aria-label={formatDate(entry.date)}
              className="d2-card-frame flex shrink-0 flex-col gap-2 p-4 [--card-radius:14px]"
            >
              <h3 className="text-muted-foreground text-xs font-medium tabular-nums">
                <time dateTime={entry.date}>{formatDate(entry.date)}</time>
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
                {entry.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              {entry.link && (
                <a
                  href={entry.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-power w-fit text-sm underline-offset-4 hover:underline"
                >
                  {entry.link.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
