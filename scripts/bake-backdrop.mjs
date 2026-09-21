// Bakes the app backdrop's blur into static assets so the page needs no live
// CSS filter. Run after changing public/backdrop.jpg: node scripts/bake-backdrop.mjs
import sharp from "sharp";

// CSS saturate(0.6) as a colour matrix (light mode's desaturated scene).
const SATURATE_06 = [
  [0.6852, 0.286, 0.0288],
  [0.0852, 0.886, 0.0288],
  [0.0852, 0.286, 0.6288],
];

// Blur at source size (24px at a ~1920 viewport), then shrink: a blurred
// image carries no detail, so 1280 wide upscales cleanly.
const blurred = () => sharp("public/backdrop.jpg").blur(24);

await blurred().resize(1280).webp({ quality: 90 }).toFile("public/backdrop-blur.webp");
await blurred()
  .recomb(SATURATE_06)
  .resize(1280)
  .webp({ quality: 90 })
  .toFile("public/backdrop-blur-light.webp");
