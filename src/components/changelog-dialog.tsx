"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CHANGELOG } from "@/lib/changelog";
import { seenFlag } from "@/lib/seen-flag";

// Whether the dialog is open lives here, not in the button: the sidebar that holds the
// button comes and goes (the mobile menu drawer, the desktop breakpoint), and the one
// dialog AppShell mounts has to outlive it. Same pattern as the bug report dialog.
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

/** Open the Changelog. */
export const openChangelog = () => setOpen(true);

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
 * The Changelog: every entry in lib/changelog.ts, newest first, scrolling back to the
 * first release. The only place the app announces what's new; it never opens by itself.
 */
export function ChangelogDialog() {
  const open = useSyncExternalStore(subscribe, () => isOpen, () => false);
  // Focus starts on the list, not its first link (an older release's), so it opens at
  // the top and the arrow keys scroll it.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (HASHES.includes(window.location.hash)) openChangelog();
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        initialFocus={list}
        className="flex max-h-[min(80dvh,40rem)] flex-col gap-0 p-0 sm:max-w-md"
      >
        <DialogHeader className="px-5 pt-5 pb-4 pr-12">
          <DialogTitle className="text-lg">What&apos;s new</DialogTitle>
          <DialogDescription>Every release, newest first.</DialogDescription>
        </DialogHeader>
        <div
          ref={list}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 outline-none"
        >
          {CHANGELOG.map((entry) => (
            <section key={entry.date} aria-label={formatDate(entry.date)} className="flex flex-col gap-2">
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
        <DialogFooter className="mx-0 mb-0">
          <DialogClose render={<Button />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
