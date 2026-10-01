"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
 * Views that don't wait for the player's gear: the public weapon catalog loads on its
 * own, and Settings only reads this device's preferences.
 */
const UNGATED_PATHS: ReadonlySet<string> = new Set(["/weapons", "/settings"]);

/** The overlay's fade-out once everything is ready; it unmounts when the fade ends. */
const FADE_MS = 200;

/**
 * Full-screen "Loading your armor" overlay for first load / refresh. Covers the
 * app while the session, manifest, and armory resolve, drives the progress bar
 * from real load stages, then sweeps to 100% and fades out. Hides immediately
 * for signed-out visitors and on errors (the inline status cards own those).
 */
export function LoadingScreen() {
  const pathname = usePathname();
  const session = useSession();
  const manifestStatus = useManifest();
  const armory = useArmory();

  const view = loadingView({
    sessionPending: session.isPending,
    sessionError: session.isError,
    authenticated: session.data?.authenticated ?? false,
    manifest: manifestStatus,
    armoryPending: armory.isPending,
    armoryError: armory.isError,
  });

  // "up" while the overlay covers a load, "gone" once that load is over (for good:
  // later refetches never bring it back). The finish (sweep and fade) only plays for an
  // overlay that was up: when the data lands while the player is on an ungated view, or
  // behind an error card, showing it then would flash the loader over a ready app.
  const gated = !UNGATED_PATHS.has(pathname);
  const [stage, setStage] = useState<"idle" | "up" | "gone">(
    gated && view.phase === "loading" ? "up" : "idle",
  );
  let next = stage;
  if (stage !== "gone") {
    if (view.phase === "done") next = gated && stage === "up" ? "up" : "gone";
    else next = gated && view.phase === "loading" ? "up" : "idle";
  }
  if (next !== stage) setStage(next);
  const dismiss = useCallback(() => setStage("gone"), []);

  if (next !== "up") return null;

  return (
    <ActiveLoadingScreen
      target={view.target}
      message={view.message}
      done={view.phase === "done"}
      onGone={dismiss}
    />
  );
}

/**
 * The overlay while it's up. Split out so the progress loop only runs while there is
 * an overlay to draw: once it's hidden (signed out, errors) or dismissed, nothing ticks.
 */
function ActiveLoadingScreen({
  target,
  message,
  done,
  onGone,
}: {
  target: number;
  message: string;
  done: boolean;
  onGone: () => void;
}) {
  const progress = useEasedProgress(target, done);

  // Once everything is ready the app takes clicks and the overlay fades straight away,
  // the bar sweeping to 100% as it goes: holding the app covered to finish the bar first
  // only delayed it. Cancelled if `done` flips back (e.g. session expiry mid-fade).
  useEffect(() => {
    if (!done) return;
    const goneTimer = setTimeout(onGone, FADE_MS);
    return () => clearTimeout(goneTimer);
  }, [done, onGone]);

  return <LoadingScreenView progress={progress} message={message} fading={done} />;
}

/**
 * Drifting exotics. Purely decorative; reduced motion pauses them in place. Memoized so
 * the progress bar's per-frame state updates don't reconcile twelve images each tick.
 */
const Tiles = memo(function Tiles() {
  return (
    <div aria-hidden className="absolute inset-0">
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
              // Near tiles cast a soft shadow onto the scene; far ones stay flat.
              tile.blur ? "blur-[1.5px]" : "shadow-[0_10px_28px_rgb(0_0_0/0.35)]",
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
  );
});

/** Presentational overlay: floating pixel-art exotics over the app's scene, with the progress text centered on it. */
export function LoadingScreenView({
  progress,
  message,
  fading,
}: {
  progress: number;
  message: string;
  /** The app is ready: fade out and let clicks through to it. */
  fading: boolean;
}) {
  const pct = Math.round(progress * 100);

  return (
    <div
      role="status"
      aria-live="polite"
      // The unblurred scene, always dark inside: the text sits straight on the
      // photo, whatever the app theme. Fading out pulls focus to the blurred
      // copy the app floats over.
      className={cn(
        "app-backdrop-sharp dark text-foreground fixed inset-0 z-[60] overflow-hidden transition-opacity ease-out",
        fading && "pointer-events-none opacity-0",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <Tiles />

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6">
        <div className="flex w-full max-w-sm flex-col gap-3 [text-shadow:0_1px_8px_rgb(0_0_0/0.6)]">
          <h1 className="d2-heading text-lg">Loading your armor</h1>
          {/* Drawn like the stat slider's track (ui/slider.tsx): a 10px well
              framed by the line with a 2px gap and the green fill in the white
              line. The faint white tint echoes the slider's achievable-ceiling fill. */}
          <div
            role="progressbar"
            aria-label="Loading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="d2-line bg-foreground/10 p-0.5"
          >
            <div
              className="d2-line-white d2-fill h-2.5"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex w-full items-baseline justify-between gap-4">
            <span className="d2-label truncate text-xs text-foreground/90">{message}</span>
            <span className="d2-label text-xs text-foreground/90 tabular-nums">{pct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
