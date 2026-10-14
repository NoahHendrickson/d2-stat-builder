// Stat optimizer (/): targets filter the builds, a build opens, Dream build answers, and
// "Save as loadout" stores a loadout that the Loadouts page then lists. See features/optimizer.md.
export const meta = { fixture: "full" };

const CARD = { role: "button", name: / Health \d+ Melee \d+ Grenade \d+ Super \d+ Class \d+ Weapons \d+/ };
const COUNT = /^(\d[\d,]*) \/ ([\d,]+)(\+?)$/;

export default async function ({ page, app, stub, step, shot, expect, log }) {
  /** The results status once the search has settled ("50 / 200+", "No builds match", …). */
  const settled = async () => {
    await page.waitFor({ role: "progressbar", name: "Search progress" }, { gone: true, timeout: 120000 });
    return page.waitForText(/\b\d[\d,]* \/ [\d,]+\+?|No builds match/, { timeout: 60000 });
  };

  await step("open the optimizer with results", async () => {
    await app.open("/");
    const status = await settled();
    log(`  status: ${status}`);
    expect(COUNT.test(status), `results count reads N / M (${status})`);
    expect((await page.count(CARD)) > 0, "build cards are listed");
    await shot("results");
  });

  await step("opt-target: a Health target filters the builds", async () => {
    await page.fill({ role: "spinbutton", name: "Health target value" }, "100");
    await page.press("Enter");
    await page.waitFor(async () => (await page.attr({ role: "spinbutton", name: "Health target value" }, "value")) === "100");
    // The search reruns 250 ms after an edit: wait for the end state, not for a quiet moment.
    const healthOnCards = async () => {
      const cards = await page.findAll(CARD);
      const h = [];
      for (let nth = 0; nth < Math.min(cards.length, 10); nth++) h.push(Number(/ Health (\d+) /.exec(await page.name({ ...CARD, nth }))?.[1]));
      return h;
    };
    await page.waitFor(async () => { const h = await healthOnCards(); return h.length > 0 && h.every((x) => x >= 100); }, { timeout: 60000 });
    const status = await settled();
    log(`  status: ${status}`);
    const health = await healthOnCards();
    expect(health.length > 0, `builds still listed at Health 100 (${status})`);
    log(`  Health on the first ${health.length} cards: ${health.join(", ")}`);
    expect(health.every((h) => h >= 100), "every listed build has Health ≥ 100");
    await shot("health-100");
  });

  await step("opt-open: a build card expands to its pieces", async () => {
    await page.click({ ...CARD, nth: 0 });
    await page.waitFor(async () => (await page.attr({ ...CARD, nth: 0 }, "aria-expanded")) === "true");
    await page.waitForText(/masterwork/i);
    expect(true, "first card is expanded (aria-expanded=true) and shows Masterwork");
  });

  await step("opt-dream: Dream build answers for the first build", async () => {
    await page.click({ role: "button", name: "Dream build", nth: 0 });
    await page.waitFor({ role: "dialog", name: "Dream build" });
    const dialog = { role: "dialog", name: "Dream build" };
    const health = { role: "spinbutton", name: "Health target value" };
    const search = { role: "progressbar", name: "Dream build search" };
    // Every edit restarts the search: read an answer only once the search is idle.
    const answer = async () => {
      await page.waitFor(async () => (await page.attr(search, "aria-busy", { within: dialog })) === "false", { timeout: 60000 });
      return page.waitForText(/No farming needed|Out of reach|\d+ new pieces?|Search failed/, { within: dialog, timeout: 60000 });
    };
    const first = await answer();
    log(`  dream status at the build's own stats: ${first}`);
    expect(first === "No farming needed", "the build as it stands needs no farming");
    const start = Number(await page.attr(health, "value", { within: dialog }));
    for (let i = 0; i < 10; i++) await page.click({ role: "button", name: "Raise Health by 1" }, { within: dialog, settle: 40 });
    await page.waitFor(async () => Number(await page.attr(health, "value", { within: dialog })) === start + 10);
    const after = await answer();
    log(`  dream status after Health ${start} → ${start + 10}: ${after}`);
    expect(after !== "Search failed", `Dream build answers a raised target (${after})`);
    await shot("dream", { within: dialog });
    await page.click({ role: "button", name: "Close dialog" }, { within: dialog });
    await page.waitFor(dialog, { gone: true });
  });

  await step("opt-save: Save as loadout stores it and Loadouts lists it", async () => {
    await page.hover({ ...CARD, nth: 0 });
    await page.click({ role: "button", name: "Save as loadout", nth: 0 });
    const drawer = { role: "dialog", name: "Save loadout" };
    await page.waitFor(drawer);
    await page.fill({ role: "textbox", name: "Loadout name" }, "verify-d2 build", { within: drawer });
    await shot("save-drawer", { within: drawer });
    await page.click({ role: "button", name: "Save" }, { within: drawer });
    await page.waitFor(drawer, { gone: true });
    const toast = await page.waitFor(async () => (await app.toasts()).find((t) => /Loadout saved/.test(t)));
    expect(toast, `toast "${toast}"`);
    const post = stub.requests.find((r) => r.method === "POST" && r.path === "/api/loadouts");
    expect(post?.status === 201, "POST /api/loadouts answered 201");
    expect(post.body?.loadout?.name === "verify-d2 build", `request carries the name (${post.body?.loadout?.name})`);
    expect(post.body.loadout.equipped?.length >= 5, `request carries the armor (${post.body.loadout.equipped?.length} items)`);
    await app.nav("Loadouts", "/loadouts");
    await page.waitFor({ role: "article", name: "verify-d2 build" });
    expect(true, 'Loadouts lists an article named "verify-d2 build"');
    await shot("loadouts-after-save");
  });
}
