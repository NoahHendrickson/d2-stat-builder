import { describe, expect, test } from "vitest";

import { expandWeaponQueryAliases, WEAPON_NAME_ALIASES } from "./aliases";

describe("expandWeaponQueryAliases", () => {
  test("expands known shorthands case-insensitively", () => {
    expect(expandWeaponQueryAliases("hc")).toBe("hand cannon");
    expect(expandWeaponQueryAliases("HC")).toBe("hand cannon");
    expect(expandWeaponQueryAliases("  smg ")).toBe("submachine gun");
  });

  test("leaves unknown tokens unchanged", () => {
    expect(expandWeaponQueryAliases("fatebringer")).toBe("fatebringer");
    expect(expandWeaponQueryAliases("")).toBe("");
  });

  test("every alias maps to a non-empty lowercase canonical term", () => {
    for (const [alias, canonical] of Object.entries(WEAPON_NAME_ALIASES)) {
      expect(alias).toBe(alias.toLowerCase());
      expect(canonical.length).toBeGreaterThan(0);
      expect(canonical).toBe(canonical.toLowerCase());
    }
  });
});
