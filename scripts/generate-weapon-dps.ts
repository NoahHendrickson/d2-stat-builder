import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompactWeaponIndex } from "../src/lib/weapons/transport";
import {
  DPS_SHEET_CSV_URL,
  buildWeaponDpsIndex,
} from "../src/lib/weapons/weapon-dps";
import { writeFileAtomic } from "./write-file-atomic";

/**
 * Snapshots boss DPS from Aegis's spreadsheet into public/data/weapon-dps.json,
 * matched against the names in the committed weapon catalog. Run
 * `npm run generate:weapons` first if the catalog is out of date.
 */
async function main() {
  const catalog = JSON.parse(
    await readFile(resolve("public/data/weapons.json"), "utf8"),
  ) as CompactWeaponIndex;
  console.log("Downloading the DPS sheet…");
  const response = await fetch(DPS_SHEET_CSV_URL);
  if (!response.ok)
    throw new Error(`The DPS sheet could not be downloaded (${response.status}).`);
  const index = buildWeaponDpsIndex(
    await response.text(),
    catalog.weapons.map((w) => w.name),
  );
  const weapons = Object.keys(index.weapons).length;
  if (weapons < 20)
    throw new Error(
      `Only ${weapons} weapons matched; the previous snapshot has been preserved.`,
    );
  const target = resolve("public/data/weapon-dps.json");
  await writeFileAtomic(target, JSON.stringify(index));
  const setups = Object.values(index.weapons).reduce((n, s) => n + s.length, 0);
  console.log(`Wrote ${setups} setups for ${weapons} weapons to ${target}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
