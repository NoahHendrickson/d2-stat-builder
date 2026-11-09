import { describe, expect, test } from "vitest";
import type { ActivitySetRunState } from "./activity-set-run";
import type { ActivitySet } from "./activity-sets";
import {
  draftFromSet,
  draftFromSlots,
  newSetDraft,
  pendingCopies,
  savedSetFromDraft,
  setFooterStatus,
  withSlotCopy,
  withSlotLoadout,
  type SetDraft,
} from "./set-draft";
import type { SavedLoadoutData } from "./types";

const data = (name: string) =>
  ({ version: 1, loadout: { name } }) as unknown as SavedLoadoutData;
const labels = { nameHash: 1, iconHash: 2, colorHash: 3 };
const saved: ActivitySet = {
  id: "set",
  name: "Raid",
  characterId: "1",
  classType: 0,
  slots: [{ index: 1, loadoutId: "stored" }],
};

describe("slot copies", () => {
  test("a set from slots holds one private copy per slot, with its labels", () => {
    const draft = draftFromSlots("1", 0, [
      { index: 2, data: data("B"), labels },
      { index: 0, data: data("A") },
    ]);
    expect(draft.set.slots.map((s) => s.index)).toEqual([0, 2]);
    expect(draft.set.slots[1].labels).toEqual(labels);
    expect(Object.values(draft.copies).every((c) => c.setOnly === true)).toBe(true);
  });

  test("replacing a slot's copy drops the old one", () => {
    const first = withSlotCopy(newSetDraft("1", 0), { index: 0, data: data("A") }, "a");
    const second = withSlotCopy(first, { index: 0, data: data("B") }, "b");
    expect(Object.keys(second.copies)).toEqual(["b"]);
    expect(second.set.slots).toEqual([{ index: 0, loadoutId: "b" }]);
  });

  test("a copy keeps the labels chosen for the slot", () => {
    const labelled: SetDraft = draftFromSet({
      ...saved,
      slots: [{ index: 1, loadoutId: "stored", labels }],
    });
    expect(withSlotCopy(labelled, { index: 1, data: data("A") }, "a").set.slots).toEqual([
      { index: 1, loadoutId: "a", labels },
    ]);
  });

  test("taking a slot out drops its copy", () => {
    const draft = withSlotCopy(newSetDraft("1", 0), { index: 0, data: data("A") }, "a");
    const cleared = withSlotLoadout(draft, 0, undefined);
    expect(cleared.set.slots).toEqual([]);
    expect(cleared.copies).toEqual({});
  });
});

describe("saving", () => {
  test("only the copies its slots use are stored, and get their real ids", () => {
    const draft = withSlotCopy(draftFromSet(saved), { index: 3, data: data("A") }, "temp");
    expect(pendingCopies(draft).map((c) => c.id)).toEqual(["temp"]);
    const set = savedSetFromDraft(draft, "Raid", new Map([["temp", "real"]]));
    expect(set.slots.map((s) => s.loadoutId)).toEqual(["stored", "real"]);
  });
});

describe("setFooterStatus", () => {
  const base = {
    set: saved,
    isNew: false,
    dirty: false,
    saving: false,
    hasCharacter: true,
    run: null,
    canRun: true,
  };
  const run = (setId: string): ActivitySetRunState => ({
    setId,
    position: 1,
    total: 2,
    stopping: false,
  });

  test("a running set can only be stopped", () => {
    expect(setFooterStatus({ ...base, run: run("set"), dirty: true }).kind).toBe("running");
  });

  test("an unnamed set stays savable, so pressing Save shows what's missing", () => {
    const status = setFooterStatus({ ...base, isNew: true, set: { ...saved, name: " ", slots: [] } });
    expect(status).toMatchObject({ kind: "unsaved", canSave: true, message: "Name this set to save it" });
  });

  test("a named set needs a loadout", () => {
    const status = setFooterStatus({ ...base, isNew: true, set: { ...saved, slots: [] } });
    expect(status).toMatchObject({ canSave: false, message: "Add a loadout to save it" });
  });

  test("it can't be saved twice at once", () => {
    expect(setFooterStatus({ ...base, dirty: true, saving: true })).toMatchObject({ canSave: false });
  });

  test("a saved set applies only when nothing stands in the way", () => {
    expect(setFooterStatus(base)).toEqual({ kind: "saved", canApply: true });
    expect(setFooterStatus({ ...base, canRun: false })).toEqual({ kind: "saved", canApply: false });
    expect(setFooterStatus({ ...base, run: run("other") })).toEqual({ kind: "saved", canApply: false });
    expect(setFooterStatus({ ...base, set: { ...saved, slots: [] } })).toEqual({
      kind: "saved",
      canApply: false,
    });
  });

  test("a set whose character has gone offers nothing", () => {
    expect(setFooterStatus({ ...base, hasCharacter: false })).toEqual({ kind: "unavailable" });
  });
});
