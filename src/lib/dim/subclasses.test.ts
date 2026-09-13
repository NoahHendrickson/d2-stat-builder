import { expect, test } from "vitest";
import { isStrandSharedAbilityIcon } from "./subclasses";

test("Strand class abilities and jumps reuse Stasis icon files", () => {
  expect(isStrandSharedAbilityIcon("warlock.strand.class_abilities")).toBe(true);
  expect(isStrandSharedAbilityIcon("hunter.strand.movement")).toBe(true);
  expect(isStrandSharedAbilityIcon("titan.strand.class_abilities")).toBe(true);
});

test("other Strand plugs and other subclasses keep their own art", () => {
  expect(isStrandSharedAbilityIcon("warlock.strand.melee")).toBe(false);
  expect(isStrandSharedAbilityIcon("shared.strand.grenades")).toBe(false);
  expect(isStrandSharedAbilityIcon("warlock.strand.supers")).toBe(false);
  expect(isStrandSharedAbilityIcon("warlock.stasis.class_abilities")).toBe(false);
  expect(isStrandSharedAbilityIcon("warlock.prism.movement")).toBe(false);
  expect(isStrandSharedAbilityIcon(undefined)).toBe(false);
});
