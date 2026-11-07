// Items (/manager): the "Show ornaments" setting. See features/manager.md (mgr-ornaments).
// The fixture has no ornaments, so every vault item gets one: a helmet the fixture owns
// stands in for the ornament's definition (any item def with an icon reads the same).
const HELMET_BUCKET = 3448274439;
const VAULT_IMG = '[aria-label="Vault"] [role=button][draggable] img';

export const meta = {
  fixture: "full",
  profile: (profile) => {
    const equipped = Object.values(profile.characterEquipment.data).flatMap((c) => c.items);
    const helmet = equipped.find((i) => i.bucketHash === HELMET_BUCKET);
    for (const item of profile.profileInventory.data.items) item.overrideStyleItemHash = helmet.itemHash;
    return profile;
  },
};

export default async function ({ page, app, step, shot, expect, log }) {
  const toggle = { role: "menuitemcheckbox", name: /^Show ornaments/ };
  // How many mounted vault tiles draw the most common art, and how many are mounted.
  const art = async () =>
    JSON.parse(
      await page.evalJs(`(() => {
        const srcs = [...document.querySelectorAll(${JSON.stringify(VAULT_IMG)})]
          .map((img) => img.currentSrc || img.src)
          .filter(Boolean);
        const counts = {};
        for (const s of srcs) counts[s] = (counts[s] || 0) + 1;
        const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ["", 0];
        return JSON.stringify({ top, n, total: srcs.length });
      })()`),
    );

  await step("mgr-ornaments: Show ornaments swaps every ornamented tile's art", async () => {
    await app.open("/manager");
    await page.waitFor({ role: "region", name: "Characters and vault" });
    await page.click({ role: "button", name: "Items settings" });
    expect((await page.attr(toggle, "aria-checked")) === "false", "Show ornaments starts off");
    await shot("menu-off");
    const off = await art();
    log(`off: ${off.n} of ${off.total} vault images share the top art`);

    await page.click(toggle);
    await page.waitFor(async () => (await page.attr(toggle, "aria-checked")) === "true");
    await page.waitFor(async () => (await art()).n > off.n);
    // A closing menu stays in the DOM through its exit animation, so give it time to go.
    const closed = await page.waitFor(toggle, { gone: true, timeout: 1000 }).then(() => true, () => false);
    expect(!closed, "the menu stays open after toggling");
    const on = await art();
    log(`on: ${on.n} of ${on.total} vault images share the top art`);
    expect(on.n > off.n, `more tiles wear the ornament with it on (${off.n} → ${on.n})`);
    await shot("menu-on");
    await page.press("Escape");
    await shot("vault-ornaments-on");

    const saved = JSON.parse(await page.evalJs(`localStorage.getItem("stat-builder:manager-view:v1")`));
    expect(saved?.showOrnaments === true, "the setting is saved");

    // Survives a reload, and turning it off brings the tiles' own art back.
    await app.open("/manager");
    await page.waitFor(async () => (await art()).n >= on.n);
    await page.click({ role: "button", name: "Items settings" });
    expect((await page.attr(toggle, "aria-checked")) === "true", "still on after a reload");
    await page.click(toggle);
    await page.waitFor(async () => (await art()).n < on.n);
    expect((await art()).n === off.n, "off again: only the exotic weapons keep the ornament");
  });
}
