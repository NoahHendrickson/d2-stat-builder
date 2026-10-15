/** The sample grid an icon is shrunk to before its colour is read. */
const SAMPLE_PX = 24;

/**
 * An emblem icon's main colour as `rgb(r g b)`, read from the loaded image: an average that
 * weighs each pixel by how vivid it is, so a bright mark on a dark field wins over the field.
 * Needs the image loaded with `crossOrigin="anonymous"` (Bungie's images allow it); undefined
 * if the canvas can't be read.
 */
export function iconTint(img: HTMLImageElement): string | undefined {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SAMPLE_PX;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, SAMPLE_PX, SAMPLE_PX);
    const { data } = ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX);
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      // Saturation × brightness, plus a little so a greyscale icon still averages out;
      // see-through pixels count for nothing.
      const weight = (((max - min) / 255) * (max / 255) + 0.02) * (data[i + 3] / 255);
      r += data[i] * weight;
      g += data[i + 1] * weight;
      b += data[i + 2] * weight;
      total += weight;
    }
    if (total === 0) return undefined;
    return `rgb(${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)})`;
  } catch {
    // A tainted canvas (the image loaded without CORS).
    return undefined;
  }
}
