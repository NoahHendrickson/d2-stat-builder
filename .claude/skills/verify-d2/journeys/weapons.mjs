// Weapon search (/weapons): name search, a filter chip from suggestions, the details pane,
// and picking a perk. Data is the static /data/weapons.json plus Clarity. See features/weapons.md.
export const meta = { fixture: "small" };

const LIST = { role: "list", name: "Weapons" };
const STATUS = /(\d[\d,]*) weapons/;

export default async function ({ page, app, step, shot, expect, log }) {
  // The count lives in a status whose "weapons" word is screen-reader-only: read its accessible
  // name (innerText splits it across lines).
  const STATUS_EL = { role: "status", name: /weapons|Loading|Updating/i };
  const statusText = () => page.name(STATUS_EL).catch(() => "");
  const count = async () => Number(STATUS.exec(await statusText())?.[1].replace(/,/g, "") ?? NaN);
  const settledCount = async () => {
    await page.waitFor(async () => { const t = await statusText(); return STATUS.test(t) && !/Updating|Loading/.test(t); });
    return count();
  };
  const box = { role: "combobox", name: "Search weapons" };

  let total, name;
  await step("open the catalog", async () => {
    await app.open("/weapons");
    total = await settledCount();
    log(`  ${total} weapons`);
    expect(total > 100, "the catalog loaded");
    const first = await page.findAll({ role: "button", name: /^View .+ perks$/ }, { within: LIST });
    name = /^View (.+) perks$/.exec(await page.name(first[3]))[1];
    log(`  will search for "${name}"`);
    await shot("catalog");
  });

  await step("wpn-search: a name search narrows the list to it", async () => {
    await page.fill(box, name);
    await page.waitFor(async () => (await count()) < total);
    const n = await settledCount();
    expect(n >= 1 && n < total, `"${name}" → ${n} weapons`);
    expect(await page.exists({ role: "button", name: `View ${name} perks` }, { within: LIST }), "the weapon is listed");
    await page.press("Escape");
    await page.click({ role: "button", name: "Clear search and filters" });
    await page.waitFor(async () => (await count()) === total);
  });

  await step("wpn-filter: a suggestion becomes a removable chip", async () => {
    await page.click(box);
    await page.type("anti-champion");
    // A category suggestion ("Champion") drills in; its values ("Barrier 570") make the chip.
    const listbox = { role: "listbox", name: "Filter suggestions" };
    const chipName = async () => { const c = await page.findAll({ role: "button", name: /^Remove / }); return c.length ? page.name(c[0]) : null; };
    for (let depth = 0; depth < 3 && !(await chipName()); depth++) {
      await page.waitFor({ role: "option" }, { within: listbox });
      log(`  picking suggestion "${await page.name({ role: "option", nth: 0 }, { within: listbox })}"`);
      await page.click({ role: "option", nth: 0 }, { within: listbox });
    }
    const chip = await page.waitFor(chipName);
    log(`  chip: ${chip}`);
    const n = await settledCount();
    expect(n > 0 && n < total, `filtered to ${n} of ${total}`);
    expect(/champion=/.test(await page.evalJs("location.search")), "the filter is in the URL");
    await shot("filtered");
    await page.click({ role: "button", name: chip });
    await page.waitFor(async () => (await count()) === total);
  });

  await step("wpn-perks: opening a weapon shows its perk grid; picking a perk presses it", async () => {
    await page.click({ role: "button", name: `View ${name} perks` }, { within: LIST });
    const details = { role: "complementary", name: "Weapon details" };
    await page.waitFor({ role: "heading", name }, { within: details });
    const perks = await page.findAll({ role: "button", name: /./ }, { within: details });
    let picked = null;
    for (const p of perks) {
      if ((await page.attr(p, "aria-pressed")) === "false") { picked = p; break; }
    }
    expect(picked, "an unpicked perk tile exists");
    const perk = await page.name(picked);
    await page.click(picked);
    const pressed = await page.waitFor(async () => (await page.attr(picked, "aria-pressed")) === "true", { timeout: 5000 }).then(() => true, () => false);
    expect(pressed, `"${perk}" is pressed after the click`);
    await shot("perk-picked", { within: details });
  });

  await step("wpn-mods: a mod previews on hover and moves its stats once picked", async () => {
    await page.fill(box, "Fatebringer");
    await page.waitFor({ role: "button", name: "View Fatebringer perks" }, { within: LIST });
    await page.click({ role: "button", name: "View Fatebringer perks", nth: 0 }, { within: LIST });
    const details = { role: "complementary", name: "Weapon details" };
    const mods = { role: "region", name: "Mods" };
    await page.waitFor(mods, { within: details });
    // Range's value, read off the stat list: the last item on the name's line
    // (a preview's signed change sits between them).
    const range = () => page.evalJs(
      `Number([...document.querySelectorAll('[aria-label="Weapon details"] dt')].find((dt) => dt.textContent === "Range")?.parentElement?.lastElementChild?.textContent)`,
    );
    const before = await range();
    const ballistics = { role: "button", name: "Ballistics" };
    await page.hover(ballistics, { within: mods });
    await page.waitFor(async () => (await range()) > before);
    log(`  Range ${before} → ${await range()} on hover`);
    await shot("mod-hover", { within: details });
    await page.click(ballistics, { within: mods });
    expect((await page.attr(ballistics, "aria-pressed", { within: mods })) === "true", "Ballistics is pressed");
    await page.hover({ role: "heading", name: "Fatebringer" }, { within: details });
    await page.waitFor(async () => (await range()) > before);
    expect((await range()) > before, `Range stays raised (${before} → ${await range()}) with the mod picked`);
    await shot("mod-picked", { within: details });
  });

  await step("wpn-dps: See perks picks the perks the best DPS setup ran", async () => {
    await page.fill(box, "Synanceia");
    await page.waitFor({ role: "button", name: "View Synanceia perks" }, { within: LIST });
    await page.click({ role: "button", name: "View Synanceia perks", nth: 0 }, { within: LIST });
    const details = { role: "complementary", name: "Weapon details" };
    const perks = { role: "region", name: "Perks" };
    await page.click({ role: "button", name: "Advanced stats" }, { within: details });
    const see = { role: "button", name: "See perks" };
    await page.waitFor(see, { within: details });
    await page.click(see, { within: details });
    // The top setup: Jagged Edge + e. Impact, Relentless Strikes + e. Surrounded + Tenacity x20.
    const pressed = (name) => page.attr({ role: "button", name }, "aria-pressed", { within: perks });
    await page.waitFor(async () => (await pressed("Jagged Edge")) === "true");
    for (const perk of ["Jagged Edge", "Relentless Strikes", "Surrounded", "Tenacity"])
      expect((await pressed(perk)) === "true", `"${perk}" is picked`);
    expect((await pressed("Elemental Honing")) === "false", "the second setup's Elemental Honing is not");
    await shot("dps-perks", { within: details });
  });

  await step("wpn-dps: each setup shows its perks, and See perks picks the chosen one's", async () => {
    await page.fill(box, "Hezen Vengeance");
    await page.waitFor({ role: "button", name: "View Hezen Vengeance perks" }, { within: LIST });
    await page.click({ role: "button", name: "View Hezen Vengeance perks", nth: 0 }, { within: LIST });
    const details = { role: "complementary", name: "Weapon details" };
    await page.click({ role: "button", name: "Advanced stats" }, { within: details });
    const setups = { role: "radiogroup", name: "DPS setups" };
    await page.waitFor(setups, { within: details });
    const top = { role: "radio", name: /^13,514 boss DPS/ };
    const envious = { role: "radio", name: /^8,226 boss DPS/ };
    expect((await page.attr(top, "aria-checked", { within: setups })) === "true", "the top setup starts chosen");
    const see = { role: "button", name: "See perks" };
    // Hezen's two trait columns both roll these, so count the picked tiles by name.
    const picked = (name) => page.evalJs(
      `document.querySelectorAll('[aria-label="Weapon details"] [aria-label="Perks"] button[aria-label="${name}"][aria-pressed="true"]').length`,
    );
    await page.click(see, { within: details });
    await page.waitFor(async () => (await picked("Cluster Bomb")) === 1);
    expect((await picked("Elemental Honing")) === 1, "the top setup picks Cluster Bomb + Elemental Honing, once each");
    // After See perks, choosing a setup picks its perks without pressing it again.
    await page.click(envious, { within: setups });
    expect((await page.attr(envious, "aria-checked", { within: setups })) === "true", "the Envious Arsenal setup is chosen");
    await page.waitFor(async () => (await picked("Envious Arsenal")) === 1);
    expect((await picked("Cluster Bomb")) === 0, "Cluster Bomb is let go");
    expect((await picked("Elemental Honing")) === 1, "Elemental Honing stays");
    await shot("dps-setup-picked", { within: details });
    await page.click(top, { within: setups });
    await page.waitFor(async () => (await picked("Cluster Bomb")) === 1);
    expect((await picked("Envious Arsenal")) === 0, "back on the top setup, Envious Arsenal is let go");
  });
}
