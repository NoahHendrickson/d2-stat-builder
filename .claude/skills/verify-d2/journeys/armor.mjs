// Armor table (/armor): name search, Junk toggle, sorting, column header filters, Duplicates.
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

  await step("arm-sort: Then by nests a sort, and the column menu removes one", async () => {
    // Class is both a column and a stat: the column's header comes first.
    await page.click({ role: "button", name: "Sort by Class", nth: 0 });
    await page.click({ role: "menuitem", name: /A→Z/, nth: 0 });
    await page.click({ role: "button", name: "Sort by Health" });
    // The second group is "Then by Health": the nested pick.
    await page.click({ role: "menuitem", name: /High→Low/, nth: 1 });
    await page.waitFor({ role: "button", name: /^Sort by Health \(2nd of 2\)$/ });
    // Class (cell 1) ascending, and Health (the first stat, cell 6) high → low inside each class.
    const rows = await page.evalJs(`[...document.querySelectorAll("table tbody tr")].filter((r) => r.cells.length > 6).slice(0, 40).map((r) => [r.cells[1].innerText.trim(), Number(r.cells[6].innerText)])`);
    const ordered = rows.every(([cls, health], i) => {
      if (i === 0) return true;
      const [prevCls, prevHealth] = rows[i - 1];
      return prevCls < cls || (prevCls === cls && prevHealth >= health);
    });
    expect(ordered, `rows sort by Class, then Health high → low (${rows.slice(0, 3).map((r) => r.join(" ")).join(", ")}…)`);
    expect(!(await page.exists({ role: "button", name: /^Sort: / })), "the toolbar has no Sort button");
    // The column menus edit the chain: removing Class leaves Health alone, unnumbered.
    await page.click({ role: "button", name: "Sort by Class (1st of 2)" });
    await page.click({ role: "menuitem", name: "Remove from sort" });
    await page.waitFor({ role: "button", name: /\(2nd of 2\)$/ }, { gone: true });
    expect(await page.exists({ role: "button", name: "Sort by Health" }), "Health is the only sort left");
    await shot("sort-chain");
  });

  await step("arm-col-filter: a column header filter edits the toolbar filter", async () => {
    const sortClass = { role: "button", name: "Sort by Class", nth: 0 };
    const headerFilter = { role: "button", name: /^Filter Class/ };
    expect(await page.exists(headerFilter), "the filter button shows without hovering");
    const iconOpacity = (label) => page.evalJs(`getComputedStyle([...document.querySelectorAll("thead button")].find((e) => e.getAttribute("aria-label") === ${JSON.stringify(label)}).querySelector("svg")).opacity`);
    const restOpacity = Number(await iconOpacity("Filter Class"));
    await page.hover(headerFilter);
    await page.waitFor(async () => Number(await iconOpacity("Filter Class")) === 1);
    expect(restOpacity < 1, `the filter icon brightens on hover (${restOpacity} → 1)`);
    await page.hover(sortClass);
    const box = await page.evalJs(`(() => { const b = [...document.querySelectorAll("thead button")].find((e) => e.getAttribute("aria-label") === "Sort by Class"); const r = b.querySelector("span[aria-hidden]").getBoundingClientRect(); return [r.width, r.height]; })()`);
    expect(box[0] >= 24 && box[1] >= 24, `the sort button is 24px (${box.join("×")})`);
    await shot("column-hover", { within: { css: "thead" } });
    await page.click(headerFilter);
    await page.click({ role: "menuitemcheckbox", name: "Titan" });
    await page.waitFor(async () => (await pieces()) < total);
    const titans = await pieces();
    await page.press("Escape");
    await page.waitFor({ role: "button", name: /^Class: Titan/ });
    log(`  toolbar reads Class: Titan, ${titans} of ${total} pieces`);
    const classes = await page.evalJs(`[...new Set([...document.querySelectorAll("table tbody tr")].filter((r) => r.cells.length > 6).map((r) => r.cells[1].innerText.trim()))]`);
    expect(classes.length === 1 && classes[0] === "Titan", `only Titan rows (${classes.join(", ")})`);
    await page.hover({ role: "searchbox", name: "Search armor by name" });
    expect(await page.exists({ role: "button", name: "Filter Class: Titan" }), "the header filter names the filter in effect");
    await shot("column-filtered");
    // And back the other way: clearing the toolbar filter clears the header one.
    await page.click({ role: "button", name: "Clear class filter" });
    await page.waitFor(async () => (await pieces()) === total);
    expect(!(await page.exists({ role: "button", name: "Filter Class: Titan" })), "the header filter clears with the toolbar one");
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
