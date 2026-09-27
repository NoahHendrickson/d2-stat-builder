import { loadEnvConfig } from "@next/env";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildWeaponIndex } from "../src/lib/weapons/build-index";
import { downloadManifest } from "../src/lib/weapons/manifest";
import { compactWeaponIndex } from "../src/lib/weapons/transport";

async function main() {
  loadEnvConfig(process.cwd());
  const apiKey =
    process.env.NEXT_PUBLIC_BUNGIE_API_KEY || process.env.BUNGIE_API_KEY;
  if (!apiKey)
    throw new Error(
      "Set NEXT_PUBLIC_BUNGIE_API_KEY in .env.local to refresh the weapon catalog.",
    );
  console.log("Downloading the Destiny manifest…");
  const { version, defs } = await downloadManifest(apiKey);
  const { index } = buildWeaponIndex(defs, version);
  const compact = compactWeaponIndex(index);
  if (compact.weapons.length < 100)
    throw new Error(
      "Incomplete catalog; the previous snapshot has been preserved.",
    );
  const target = resolve("public/data/weapons.json");
  await mkdir(resolve("public/data"), { recursive: true });
  await writeFile(`${target}.tmp`, JSON.stringify(compact));
  await rename(`${target}.tmp`, target);
  console.log(
    `Updated ${compact.weapons.length} weapons from manifest ${version}.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Weapon catalog generation failed.",
  );
  process.exitCode = 1;
});
