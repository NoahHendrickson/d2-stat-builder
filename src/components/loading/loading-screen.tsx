"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSession } from "@/lib/auth/use-session";
import { useManifest } from "@/lib/manifest/use-manifest";
import { useArmory } from "@/lib/armory/use-armory";
import { loadingView } from "@/lib/loading/progress";
import { cn } from "@/lib/utils";

/**
 * Startup-specific progress smoother: eases the displayed fraction toward the
 * stage target (with a slight forward trickle so the bar never sits dead,
 * capped just ahead of the target), sweeps to 100% once `done`, and holds
 * there — the component owns fade-out/unmount timing. One-shot by design;
 * the optimizer's multi-run smoothing lives in `useSmoothedProgress`.
 */
function useEasedProgress(target: number, done: boolean): number {
  const [displayed, setDisplayed] = useState(0);
  const displayedRef = useRef(0);
  const goalRef = useRef({ target, done });

  useEffect(() => {
    goalRef.current = { target, done };
  }, [target, done]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const { target: t, done: d } = goalRef.current;
      const prev = displayedRef.current;
      let next: number;
      if (d) {
        next = prev + (1 - prev) * (1 - Math.exp(-25 * dt));
        if (next >= 0.995) {
          // Landed — pin at 100% and stop the loop (nothing left to animate).
          displayedRef.current = 1;
          setDisplayed(1);
          return;
        }
      } else {
        const eased = prev + Math.max(0, t - prev) * (1 - Math.exp(-14 * dt));
        const trickle = Math.min(prev + dt * 0.04, t + 0.06);
        next = Math.min(0.98, Math.max(prev, eased, trickle));
      }
      displayedRef.current = next;
      setDisplayed(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return displayed;
}

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
  const manifestStatus = useManifest();
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
  const progress = useEasedProgress(view.target, done);

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
            className="loading-tile-drift absolute left-0 will-change-transform"
            style={
              {
                top: tile.top,
                "--drift-duration": `${tile.duration}s`,
                "--drift-delay": `${tile.delay}s`,
                "--drift-direction": tile.reverse ? "reverse" : "normal",
              } as CSSProperties
            }
          >
            <Image
              src={`/loading-exotics/exotic-${tile.img}.svg`}
              alt=""
              width={tile.size}
              height={tile.size}
              unoptimized
              draggable={false}
              className={cn(
                "loading-tile-bob select-none",
                tile.blur && "blur-[1.5px]",
              )}
              style={
                {
                  opacity: tile.opacity,
                  "--bob-duration": `${tile.bob}s`,
                  "--drift-delay": `${tile.delay}s`,
                } as CSSProperties
              }
            />
          </div>
        ))}
      </div>

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <div className="bg-background/90 flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl px-8 py-6 backdrop-blur-sm">
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
    </div>
  );
}
