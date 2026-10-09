"use client";

import { memo, useEffect, useRef, useState } from "react";
import { SITE_ICONS, useSiteIcon } from "@/lib/site-icon";
import { cn } from "@/lib/utils";

/** The site icons are 24×24 pixel-art grids (public/favicons). */
const GRID = 24;
const PIXELS = GRID * GRID;
/** How long each icon sits whole before dissolving into the next. */
const HOLD_MS = 900;
/** One icon replacing the last, pixel by pixel. */
const DISSOLVE_MS = 1100;

/** Rasterizes a site icon at its native 24×24, one RGBA word per art pixel. */
function loadIconPixels(src: string): Promise<Uint32Array> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = GRID;
      canvas.height = GRID;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no 2d context"));
      ctx.drawImage(img, 0, 0, GRID, GRID);
      try {
        resolve(new Uint32Array(ctx.getImageData(0, 0, GRID, GRID).data.buffer));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

/** Every pixel index once, in random order: the order a dissolve swaps them in. */
function shuffledPixels(): Uint16Array {
  const order = new Uint16Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) order[i] = i;
  for (let i = PIXELS - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The site icons (Settings → site icon) in turn, each dissolving into the next one
 * random pixel at a time. Starts on the player's picked icon. A 24×24 canvas scaled up
 * with pixelated sampling, so every art pixel stays a crisp square. Reduced motion
 * shows the first icon still. Memoized so the loader's per-frame progress updates
 * never touch it; size it with `className`.
 */
export const PixelDissolve = memo(function PixelDissolve({ className }: { className?: string }) {
  const { id: startId } = useSiteIcon();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const start = Math.max(0, SITE_ICONS.findIndex((i) => i.id === startId));
    const loads = [...SITE_ICONS.slice(start), ...SITE_ICONS.slice(0, start)].map((i) =>
      loadIconPixels(i.src),
    );
    const frame = new ImageData(GRID, GRID);
    const framePx = new Uint32Array(frame.data.buffer);
    let cancelled = false;
    let raf = 0;

    // Paint the first icon as soon as it's in, without waiting on the rest.
    loads[0].then(
      (first) => {
        if (cancelled) return;
        framePx.set(first);
        ctx.putImageData(frame, 0, 0);
        setShown(true);
      },
      () => {},
    );

    Promise.all(loads).then(
      (icons) => {
        if (cancelled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        let from = 0;
        let order = shuffledPixels();
        let swapped = 0;
        let dissolving = false;
        let phaseStart = performance.now();
        const tick = (now: number) => {
          const t = now - phaseStart;
          if (!dissolving) {
            if (t >= HOLD_MS) {
              dissolving = true;
              phaseStart = now;
            }
          } else {
            // Ease in and out so the swap starts and ends on a trickle of pixels.
            const p = Math.min(1, t / DISSOLVE_MS);
            const goal = Math.round(PIXELS * p * p * (3 - 2 * p));
            const to = icons[(from + 1) % icons.length];
            for (; swapped < goal; swapped++) framePx[order[swapped]] = to[order[swapped]];
            ctx.putImageData(frame, 0, 0);
            if (swapped === PIXELS) {
              from = (from + 1) % icons.length;
              order = shuffledPixels();
              swapped = 0;
              dissolving = false;
              phaseStart = now;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      () => {},
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [startId]);

  return (
    <canvas
      ref={canvasRef}
      width={GRID}
      height={GRID}
      aria-hidden
      className={cn(
        "shadow-[0_12px_32px_rgb(0_0_0/0.35)] transition-opacity duration-200 [image-rendering:pixelated]",
        !shown && "opacity-0",
        className,
      )}
    />
  );
});
