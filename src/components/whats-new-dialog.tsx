"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
import { useArmory } from "@/lib/armory/use-armory";
import { useSession } from "@/lib/auth/use-session";
import { loadingView } from "@/lib/loading/progress";
import { useManifest } from "@/lib/manifest/use-manifest";

/**
 * Bump for the next release's notes: anyone who dismissed an older one sees the new
 * one once.
 */
const RELEASE_ID = "2026-10-sidebar";
const SEEN_KEY = "stat-builder:whats-new-seen";
const WHATS_NEW_HASH = "#whats-new";
const VIDEO_ID = "3u1CGhr0BAE";
/** The loading overlay's fade is 200ms; open after it so the dialog isn't drawn under it. */
const OPEN_DELAY_MS = 300;

function seenThisRelease(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === RELEASE_ID;
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, RELEASE_ID);
  } catch {
    // Best-effort: in a privacy mode it just shows again next visit.
  }
}

/**
 * The release notes, once per browser per release. Waits for the startup loader to
 * clear so it opens over the app, not under the overlay.
 */
export function WhatsNewDialog() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const session = useSession();
  const manifest = useManifest();
  const armory = useArmory();
  const loading =
    loadingView({
      sessionPending: session.isPending,
      sessionError: session.isError,
      authenticated: session.data?.authenticated ?? false,
      manifest,
      armoryPending: armory.isPending,
      armoryError: armory.isError,
    }).phase === "loading";
  // Same views the loader skips (they don't wait for gear).
  const ready = !loading || pathname === "/weapons" || pathname === "/settings";

  useEffect(() => {
    // A #whats-new link shows it again, seen or not.
    if (!ready || (seenThisRelease() && window.location.hash !== WHATS_NEW_HASH)) return;
    const timer = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        markSeen();
        if (window.location.hash === WHATS_NEW_HASH) {
          history.replaceState(history.state, "", window.location.pathname + window.location.search);
        }
      }}
    >
      <DialogContent className="flex max-h-[min(90dvh,52rem)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pt-5 pb-4 pr-12">
          <DialogTitle className="text-lg">What&apos;s new in D2 Conflux</DialogTitle>
          <DialogDescription>
            D2 Conflux is now a full toolkit for your Destiny 2 gear. Here&apos;s a quick tour.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
          {/* youtube-nocookie: no YouTube cookies until the player is used. */}
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`}
            title="D2 Conflux: what's new"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="border-foreground/8 aspect-video w-full shrink-0 border bg-black"
          />
          <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
            <li>A sidebar with every tool, plus your own links</li>
            <li>Items: move, equip, tag, compare, and search your gear, DIM-style</li>
            <li>Weapon search across every weapon in the game</li>
            <li>Loadouts with weapons, artifacts, and in-game slot saving</li>
          </ul>
        </div>
        <DialogFooter className="mx-0 mb-0 items-center">
          <Button
            variant="link"
            className="sm:mr-auto"
            render={<a href={`https://www.youtube.com/watch?v=${VIDEO_ID}`} target="_blank" rel="noreferrer" />}
            nativeButton={false}
          >
            Watch on YouTube
          </Button>
          <DialogClose render={<Button />}>Dismiss</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
