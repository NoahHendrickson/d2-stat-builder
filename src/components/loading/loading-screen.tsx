"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useArmory } from "@/lib/armory/use-armory";
import { loadingView } from "@/lib/loading/progress";
import { useSmoothedProgress } from "@/lib/use-smoothed-progress";
import { cn } from "@/lib/utils";

/**
 * One pixel-art exotic drifting across the screen. `delay` is negative so the
 * sky is already populated on first paint; `duration`/`size`/`blur` vary for a
 * loose parallax feel (small + blurred reads as far away).
 */
interface TileSpec {
  img: number;
  top: string;
  size: number;
  duration: number;
  delay: number;
  bob: number;
  opacity: number;
  reverse?: boolean;
  blur?: boolean;
}

const TILES: TileSpec[] = [
  { img: 1, top: "8%", size: 72, duration: 30, delay: -2, bob: 5.5, opacity: 0.9 },
  { img: 2, top: "19%", size: 96, duration: 24, delay: -14, bob: 6.3, opacity: 0.95 },
  { img: 3, top: "13%", size: 44, duration: 38, delay: -25, bob: 4.7, opacity: 0.55, blur: true, reverse: true },
  { img: 4, top: "68%", size: 88, duration: 26, delay: -8, bob: 5.9, opacity: 0.95 },
  { img: 5, top: "84%", size: 56, duration: 34, delay: -19, bob: 5.1, opacity: 0.7, reverse: true },
  { img: 6, top: "74%", size: 104, duration: 22, delay: -5, bob: 6.7, opacity: 0.95 },
  { img: 5, top: "30%", size: 64, duration: 29, delay: -22, bob: 5.4, opacity: 0.8 },
  { img: 1, top: "58%", size: 40, duration: 42, delay: -31, bob: 4.4, opacity: 0.5, blur: true, reverse: true },
  { img: 3, top: "88%", size: 76, duration: 27, delay: -16, bob: 6.1, opacity: 0.9 },
  { img: 6, top: "38%", size: 48, duration: 36, delay: -9, bob: 4.9, opacity: 0.6, blur: true },
  { img: 4, top: "4%", size: 52, duration: 33, delay: -27, bob: 5.7, opacity: 0.65, reverse: true },
  { img: 2, top: "50%", size: 44, duration: 40, delay: -12, bob: 4.6, opacity: 0.5, blur: true },
];

/**
 * Full-screen "Loading your armor" overlay for first load / refresh. Covers the
 * app while the session, manifest, and armory resolve, drives the progress bar
 * from real load stages, then sweeps to 100% and fades out. Hides immediately
 * for signed-out visitors and on errors (the inline status cards own those).
 */
export function LoadingScreen() {
  const session = useSession();
  // Gated so signed-out visitors never trigger the manifest download.
  const manifestStatus = useManifest(Boolean(session.data?.authenticated));
  const armory = useArmory();
  const [fading, setFading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const view = loadingView({
    sessionPending: session.isPending,
    sessionError: session.isError,
    authenticated: session.data?.authenticated ?? false,
    manifest: manifestStatus,
    armoryPending: armory.isPending,
    armoryError: armory.isError,
  });
  const done = view.phase === "done";

  // runId=1: a single "run" per page load, started on mount. `showLoading`
  // stays true through the hook's sweep-to-100% once loading finishes.
  const { displayedProgress, showLoading } = useSmoothedProgress(
    view.target,
    view.phase === "loading",
    1,
  );

  // Once everything is ready, let the sweep land (~250ms), then fade out and
  // unmount. Cancelled if `done` flips back (e.g. session expiry mid-sweep).
  useEffect(() => {
    if (!done) return;
    const fadeTimer = setTimeout(() => setFading(true), 400);
    const goneTimer = setTimeout(() => setDismissed(true), 1100);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, [done]);

  if (dismissed || view.phase === "hidden") return null;

  // The hook resets its displayed value after the final sweep; pin the bar at
  // full once loading is done and the sweep has finished.
  const progress = done && !showLoading ? 1 : displayedProgress;

  return (
    <LoadingScreenView progress={progress} message={view.message} fading={fading} />
  );
}

/** Presentational overlay: floating pixel-art exotics behind a centered progress card. */
export function LoadingScreenView({
  progress,
  message,
  fading,
}: {
  progress: number;
  message: string;
  fading: boolean;
}) {
  const pct = Math.round(progress * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "bg-background fixed inset-0 z-[60] overflow-hidden transition-opacity duration-500",
        fading && "pointer-events-none opacity-0",
      )}
    >
      {/* Drifting exotics. Purely decorative; reduced motion leaves them parked offscreen. */}
      <div aria-hidden className="absolute inset-0 motion-reduce:hidden">
        {TILES.map((tile, i) => (
          <div
            key={i}
            className="absolute left-0 will-change-transform"
            style={{
              top: tile.top,
              animation: `loading-drift ${tile.duration}s linear ${tile.delay}s infinite ${tile.reverse ? "reverse" : "normal"}`,
            }}
          >
            <Image
              src={`/loading-exotics/exotic-${tile.img}.svg`}
              alt=""
              width={tile.size}
              height={tile.size}
              unoptimized
              draggable={false}
              className={cn("select-none", tile.blur && "blur-[1.5px]")}
              style={{
                opacity: tile.opacity,
                animation: `loading-bob ${tile.bob}s ease-in-out ${tile.delay}s infinite alternate`,
              }}
            />
          </div>
        ))}
      </div>

      {/* Soft dim behind the center content so text stays readable as tiles pass. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(40rem 18rem at 50% 50%, var(--background) 35%, transparent 100%)",
        }}
      />

      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-6">
        <h1 className="text-lg font-semibold tracking-tight">
          Loading your armor
        </h1>
        <div
          role="progressbar"
          aria-label="Loading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="bg-muted h-1.5 w-full max-w-xs overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-muted-foreground flex w-full max-w-xs items-baseline justify-between gap-4 text-xs">
          <span className="truncate">{message}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      </div>
    </div>
  );
}
