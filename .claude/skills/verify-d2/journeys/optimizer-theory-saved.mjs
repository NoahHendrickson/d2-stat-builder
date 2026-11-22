// Saved theoretical builds (feedback #23): save by name, load, overwrite with confirm,
// delete, a stale build loads with a skipped notice, inputs survive a reload, phone fit.
// See features/optimizer.md (opt-theory-saved).
export const meta = { fixture: "full" };

const SAVED = { role: "button", name: "Saved theoretical builds" };
const HEALTH = { role: "spinbutton", name: "Health target value" };
const THEORY_TAB = { role: "tab", name: "Theoretical Builds" };

export default async function ({ page, app, step, shot, expect, log }) {
  const setHealth = async (v) => {
    await page.fill(HEALTH, String(v));
    await page.press("Enter");
    await page.waitFor(async () => (await page.value(HEALTH)) === String(v));
  };
  const openMenu = async () => {
    await page.click(SAVED);
    await page.waitFor({ role: "menuitem", name: "Save current build…" });
  };
  const saveAs = async (name) => {
    await openMenu();
    await page.click({ role: "menuitem", name: "Save current build…" });
    const dialog = { role: "dialog", name: "Save theoretical build" };
    await page.waitFor(dialog);
    await page.fill({ role: "textbox", name: "Build name" }, name, { within: dialog });
    await page.click({ role: "button", name: "Save" }, { within: dialog });
  };
  const stored = async () =>
    JSON.parse((await page.evalJs(`localStorage.getItem("stat-builder:theory-builds")`)) ?? "null");

  await step("menu shows only on Theoretical", async () => {
    await app.open("/");
    expect(!(await page.exists(SAVED)), "no Saved menu on Builds");
    await page.click(THEORY_TAB);
    await page.waitFor(SAVED);
    await openMenu();
    const items = await page.count({ role: "menuitem" });
    expect(items === 1, `empty list still shows the menu with just Save (${items} items)`);
    await shot("empty-menu");
    await page.press("Escape");
  });

  await step("save a build by name", async () => {
    await setHealth(100);
    await saveAs("Raid");
    await app.toast(/Saved Raid/);
    const list = await stored();
    expect(list?.builds?.length === 1 && list.builds[0].name === "Raid", "stored one build named Raid");
    expect(list.builds[0].builder.targets[1] === 100, "it stores Health 100");
    log(`  class: ${list.builds[0].classType}`);
  });

  await step("load restores the inputs", async () => {
    await setHealth(0);
    await openMenu();
    const item = { role: "menuitem", name: /^Raid/ };
    log(`  item name: ${await page.name(item)}`);
    expect(/Hunter|Warlock|Titan/.test(await page.text(item)), "the row shows the build's class");
    await shot("menu-with-build");
    await page.click(item);
    await app.toast(/Loaded Raid/);
    await page.waitFor(async () => (await page.value(HEALTH)) === "100");
    expect((await page.value(HEALTH)) === "100", "Health is back to 100");
  });

  await step("same name overwrites after a confirm", async () => {
    await setHealth(70);
    await saveAs("raid");
    const confirm = { role: "dialog", name: /^Replace raid\?/ };
    await page.waitFor(confirm);
    await shot("replace-confirm");
    await page.click({ role: "button", name: "Replace" }, { within: confirm });
    await app.toast(/Saved raid/);
    const list = await stored();
    expect(list.builds.length === 1, "still one build");
    expect(list.builds[0].name === "raid" && list.builds[0].builder.targets[1] === 70, "it now holds Health 70");
  });

  await step("inputs survive a reload", async () => {
    // Reload at once, inside the save debounce: the pagehide flush has to write it.
    await page.fill(HEALTH, "80");
    await page.press("Enter");
    const unsaved = await page.evalJs(`(() => {
      const cur = JSON.parse(localStorage.getItem("stat-builder:theory-selections") ?? "null");
      const unsaved = cur?.builder?.targets?.[1] !== 80;
      location.reload();
      return unsaved;
    })()`);
    expect(unsaved, "Health 80 wasn't stored yet when the reload started");
    await app.open("/");
    await page.click(THEORY_TAB);
    await page.waitFor(async () => (await page.value(HEALTH)) === "80");
    expect((await page.value(HEALTH)) === "80", "Theoretical Health is still 80 after reload");
  });

  await step("a stale build loads the rest and says what was skipped; malformed rows ignored", async () => {
    const list = await stored();
    const good = list.builds[0];
    const stale = {
      ...good,
      name: "Stale",
      builder: {
        ...good.builder,
        targets: [0, 0, 0, 0, 0, 0],
        exoticName: "Not A Real Exotic",
        setReqs: { 999: 2 },
        fragmentHashes: [...good.builder.fragmentHashes, 123],
      },
    };
    stale.builder.targets[5] = 50;
    await page.evalJs(
      `localStorage.setItem("stat-builder:theory-builds", ${JSON.stringify(
        JSON.stringify({ version: 1, builds: [good, stale, null, { name: "Broken" }] }),
      )})`,
    );
    await app.open("/");
    await page.click(THEORY_TAB);
    await openMenu();
    expect(!(await page.exists({ role: "menuitem", name: /^Broken/ })), "malformed row isn't listed");
    await page.click({ role: "menuitem", name: /^Stale/ });
    const t = await app.toast(/Loaded Stale/);
    log(`  toast: ${JSON.stringify(t)}`);
    await page.waitForText(/Skipped Not A Real Exotic, 1 fragment and 1 set bonus/);
    await shot("stale-toast");
    await page.waitFor(async () => (await page.value({ role: "spinbutton", name: "Melee target value" })) === "50");
    expect((await page.value({ role: "spinbutton", name: "Melee target value" })) === "50", "the rest loaded (Melee 50)");
  });

  await step("× deletes a build", async () => {
    await openMenu();
    await page.click({ role: "button", name: "Delete Stale" });
    await app.toast(/Deleted Stale/);
    const list = await stored();
    expect(list.builds.map((b) => b.name).join() === "raid", "only raid is left");
    await page.press("Escape");
  });

  await step("loading switches to the build's class", async () => {
    const before = (await stored()).builds[0].classType;
    const tabs = await page.findAll({ role: "tab", name: /, Power/ });
    log(`  class tabs: ${tabs.length}`);
    let other = null;
    for (let nth = 0; nth < tabs.length; nth++) {
      const t = { role: "tab", name: /, Power/, nth };
      if ((await page.attr(t, "aria-selected")) !== "true") { other = t; break; }
    }
    expect(other !== null, "another class tab exists");
    await page.click(other);
    await page.waitFor(async () => (await page.attr(other, "aria-selected")) === "true");
    await openMenu();
    await page.click({ role: "menuitem", name: /^raid/ });
    await app.toast(/Loaded raid/);
    await page.waitFor(async () => (await page.attr(other, "aria-selected")) !== "true");
    const names = { 0: "Titan", 1: "Hunter", 2: "Warlock" };
    const selected = { role: "tab", name: new RegExp("^" + names[before] + ", Power", "i") };
    expect((await page.attr(selected, "aria-selected")) === "true", `the ${names[before]} tab is selected again`);
    await page.waitFor(async () => (await page.value(HEALTH)) === "70");
    expect((await page.value(HEALTH)) === "70", "raid's Health 70 loaded");
  });

  await step("fits beside the tabs at phone width", async () => {
    await page.s("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    try {
      const bar = { css: '[aria-controls="builds-mobile-sheet"]' };
      await page.waitFor(bar);
      await page.click(bar);
      const sheet = { css: "#builds-mobile-sheet" };
      await page.waitFor(SAVED, { within: sheet });
      const geo = await page.evalJs(`(() => {
        const s = document.querySelector('#builds-mobile-sheet');
        const list = s.querySelector('[aria-label="Which builds to show"]').getBoundingClientRect();
        const btn = s.querySelector('[aria-label="Saved theoretical builds"]').getBoundingClientRect();
        return JSON.stringify({ list: [list.left, list.top, list.right, list.bottom], btn: [btn.left, btn.top, btn.right, btn.bottom], sheetW: s.clientWidth, scrollW: s.scrollWidth, vw: innerWidth });
      })()`);
      log(`  geometry: ${geo}`);
      const g = JSON.parse(geo);
      expect(Math.abs(g.list[1] + g.list[3] - g.btn[1] - g.btn[3]) < 8, "Saved button sits on the tabs' row");
      expect(g.btn[2] <= g.vw, "button is inside the screen");
      expect(g.scrollW <= g.sheetW, "no horizontal overflow in the sheet");
      await shot("phone-sheet", { within: sheet });
      await page.click(SAVED, { within: sheet });
      await page.waitFor({ role: "menuitem", name: "Save current build…" });
      await shot("phone-menu");
    } finally {
      await page.s("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });
}
