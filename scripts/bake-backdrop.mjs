// Bakes the app backdrop's blur into static assets so the page needs no live
// CSS filter. Run after changing assets/backdrop.jpg: npm run bake:backdrop
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

// CSS saturate(0.6) as a colour matrix (light mode's desaturated scene).
const SATURATE_06 = [
  [0.6852, 0.286, 0.0288],
  [0.0852, 0.886, 0.0288],
  [0.0852, 0.286, 0.6288],
];

// Blur at source size (1920 wide), then shrink: a blurred image carries no
// detail, so 1280 wide upscales cleanly. The blur is part of the image, so it
// scales with `background-size: cover` — equal to the old `filter: blur(24px)`
// at a 1920px-wide viewport, softer above that, sharper below.
const blurred = () => sharp(at("assets/backdrop.jpg")).blur(24);

// Quality 90 is within ~1 level (of 255) of the lossless blur on average;
// 100 barely improves on that at 3x the size, near-lossless is ~220 KB.
const WEBP = { quality: 90 };

await blurred().resize(1280).webp(WEBP).toFile(at("public/backdrop-blur.webp"));
await blurred()
  .recomb(SATURATE_06)
  .resize(1280)
  .webp(WEBP)
  .toFile(at("public/backdrop-blur-light.webp"));
