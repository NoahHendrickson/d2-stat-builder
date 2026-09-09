/**
 * Hue + saturation of the glyph, for `hsl(var(--icon-tint) <lightness>)`.
 * Skips the dark plate and blown-out white glow so the wash stays colored.
 */
export function lightTintFromPixels(data: Uint8ClampedArray): string | undefined {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.2) continue;
    const pr = data[i];
    const pg = data[i + 1];
    const pb = data[i + 2];
    const max = Math.max(pr, pg, pb) / 255;
    const min = Math.min(pr, pg, pb) / 255;
    if (max < 0.18) continue;
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.18) continue;
    // Ability icons have a bright core; don't let it pull the average to white.
    if (max > 0.9 && sat < 0.4) continue;
    const w = a * sat * sat * max;
    r += pr * w;
    g += pg * w;
    b += pb * w;
    weight += w;
  }
  if (weight <= 0) return undefined;
  const [h, s] = rgbToHsl(r / weight, g / weight, b / weight);
  const sat = Math.min(0.55, Math.max(0.4, s * 0.85));
  return `${Math.round(h)} ${Math.round(sat * 100)}%`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return [0, 0];
  const d = max - min;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s];
}

const cache = new Map<string, string | null>();

/** Instant hit from a previous sample; `undefined` if this src has not been tried. */
export function cachedLightTint(src: string): string | undefined {
  return cache.get(src) ?? undefined;
}

export function sampleLightTint(src: string): Promise<string | undefined> {
  const hit = cache.get(src);
  if (hit !== undefined) return Promise.resolve(hit ?? undefined);
  return readPixels(src)
    .then((data) => lightTintFromPixels(data))
    .catch(() => undefined)
    .then((tint) => {
      cache.set(src, tint ?? null);
      return tint;
    });
}

function readPixels(src: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, 32, 32);
      try {
        resolve(ctx.getImageData(0, 0, 32, 32).data);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}
