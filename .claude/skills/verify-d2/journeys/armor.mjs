// Armor table (/armor): name search, Searches column (build usage), Junk toggle, Duplicates.
// Usage history is seeded as 30 recorded searches that every piece could join; every other
// piece was used by 12 of them.
// See features/armor.md.
export const meta = {
  fixture: "full",
  // The fixture has no duplicate armor: clone one vault piece (same hash and roll, new id).
  profile: (profile) => {
    const stats = profile.itemComponents.stats.data;
    const items = profile.profileInventory.data.items;
    const src = items.find((i) => i.itemInstanceId && stats[i.itemInstanceId]);
    const id = "dupe1";
    items.push({ ...src, itemInstanceId: id });
    for (const comp of Object.values(profile.itemComponents)) if (comp.data?.[src.itemInstanceId]) comp.data[id] = structuredClone(comp.data[src.itemInstanceId]);
    return profile;
  },
  seed: (profile) => {
    const ids = Object.keys(profile.itemComponents.stats.data);
    const queries = Array.from({ length: 30 }, (_, q) => [q.toString(16).padStart(64, "0"), ids.map((id, i) => [id, i % 2 && q < 12 ? 1 : 0])]);
    return { usage: Object.fromEntries(queries) };
  },
};

// Table rows get no accessible name in Chrome; body rows by CSS.
const ROW = { css: "table tbody tr" };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const pieces = async () => Number(/(\d[\d,]*)\s+pieces?\b/.exec(await page.text({ role: "main" }))?.[1].replace(/,/g, ""));
  const nameOf = async (row) => (await page.name({ role: "cell", nth: 0 }, { within: row })).replace(/ Move Equip Junk$/, "");

  let total, name;
  await step("open the table", async () => {
    await app.open("/armor");
    total = await pieces();
    log(`  ${total} pieces`);
    expect(total > 0, "the table lists the fixture's armor");
    name = await nameOf({ ...ROW, nth: 0 });
    await shot("table");
  });

  await step("arm-usage: the Searches column stays hidden while usage is paused", async () => {
    // BUILD_USAGE_PAUSED (src/lib/build-usage/paused.ts): no column, no Cleanup button.
    expect(!(await page.exists({ role: "button", name: /^Sort by Searches/ })), "no Searches column header");
    expect(!(await page.exists({ role: "button", name: "Cleanup" })), "no Cleanup button");
  });

  await step("arm-search: searching by name narrows the rows", async () => {
    await page.fill({ role: "searchbox", name: "Search armor by name" }, name);
    await page.waitFor(async () => (await pieces()) < total);
    const n = await pieces();
    expect(n >= 1 && n < total, `"${name}" → ${n} pieces`);
    expect((await nameOf({ ...ROW, nth: 0 })) === name, "the first row is the searched piece");
    await page.fill({ role: "searchbox", name: "Search armor by name" }, "");
    await page.waitFor(async () => (await pieces()) === total);
  });

  await step("arm-junk: the row's Junk toggle tags the piece", async () => {
    const row = { ...ROW, nth: 0 };
    name = await nameOf(row);
    // Junk is visually hidden until the row is hovered.
    await page.hover({ role: "cell", nth: 1 }, { within: row });
    const junk = { role: "button", name: "Junk" };
    await page.click(junk, { within: row });
    await page.waitFor(async () => (await page.attr(junk, "aria-pressed", { within: row })) === "true");
    const stored = await page.evalJs(`localStorage.getItem("stat-builder:item-annotations:v1:${stub.user.membershipId}")`);
    expect(/junk/.test(stored ?? ""), `the junk tag is stored for ${name}`);
    await shot("junk");
  });

  await step("arm-dupes: Duplicates lists only the duplicate pair", async () => {
    await page.click({ role: "button", name: "Duplicates" });
    await page.waitFor(async () => (await page.attr({ role: "button", name: "Duplicates" }, "aria-pressed")) === "true");
    await page.waitFor(async () => (await page.count(ROW)) >= 2);
    const names = [];
    for (const r of await page.findAll(ROW)) names.push(await nameOf(r));
    log(`  duplicates view rows: ${names.join(" / ")}`);
    expect(names.length < total, "only duplicates are listed");
    expect(names.some((n, i) => names.indexOf(n) !== i), "the cloned piece shows up as a duplicate pair");
    await shot("duplicates");
  });
}
