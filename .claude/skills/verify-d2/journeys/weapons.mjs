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
}
