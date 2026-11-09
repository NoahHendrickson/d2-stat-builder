// Stat optimizer (/): targets filter the builds, a build opens, Dream build answers, and
// "Save as loadout" stores a loadout that the Loadouts page then lists, and a target past its
// max gets a red bar frame, is named, and is set to its max in one click. See features/optimizer.md.
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
    await page.waitFor(async () => (await page.value({ role: "spinbutton", name: "Health target value" })) === "100");
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
    // The breakdown rendering is the signal; the header's state is the check.
    await page.waitForText(/masterwork/i);
    expect((await page.attr({ ...CARD, nth: 0 }, "aria-expanded")) === "true", "first card is expanded (aria-expanded=true) and shows Masterwork");
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
    const start = Number(await page.value(health, { within: dialog }));
    for (let i = 0; i < 10; i++) await page.click({ role: "button", name: "Raise Health by 1" }, { within: dialog, settle: 40 });
    await page.waitFor(async () => Number(await page.value(health, { within: dialog })) === start + 10);
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
    log(`  toast: ${await app.toast(/Loadout saved/)}`);
    const post = stub.last("POST", "/api/loadouts");
    expect(post?.status === 201, "POST /api/loadouts answered 201");
    expect(post.body?.loadout?.name === "verify-d2 build", `request carries the name (${post.body?.loadout?.name})`);
    expect(post.body.loadout.equipped?.length >= 5, `request carries the armor (${post.body.loadout.equipped?.length} items)`);
    await app.nav("/loadouts");
    expect(await page.exists({ role: "article", name: "verify-d2 build" }), 'Loadouts lists an article named "verify-d2 build"');
    await shot("loadouts-after-save");
  });

  // ---- opt-overmax: a target past its max -------------------------------------------
  const OVER_COPY = /(\w+) can reach (at least )?(\d+) with your other targets\./;
  /** Fill a stat's number box and press Enter (Enter searches at once). */
  const setTarget = async (stat, v) => {
    await page.fill({ role: "spinbutton", name: `${stat} target value` }, String(v));
    await page.press("Enter");
  };
  /** The Super pill on every listed card (the first ten). */
  const superOnCards = async (within) => {
    const cards = await page.findAll(CARD, within ? { within } : undefined);
    const v = [];
    for (let nth = 0; nth < Math.min(cards.length, 10); nth++) v.push(Number(/ Super (\d+) /.exec(await page.name({ ...CARD, nth }, within ? { within } : undefined))?.[1]));
    return v;
  };
  let superMax = 0;

  await step("opt-overmax: a target past its max gets a red bar frame, is named, and is fixed in one click", async () => {
    await app.open("/");
    for (const [stat, v] of [["Health", 100], ["Melee", 60], ["Grenade", 90], ["Super", 200]]) await setTarget(stat, v);
    await page.waitForText(/No builds match/, { timeout: 60000 });
    const copy = await page.waitForText(OVER_COPY, { timeout: 60000 });
    const [, stat, atLeast, max] = OVER_COPY.exec(copy);
    log(`  empty list: "${copy}"`);
    expect(stat === "Super", `the message names Super (${stat})`);
    superMax = Number(max);
    expect(superMax > 0 && superMax < 200, `Super's max is between 0 and 200 (${superMax}${atLeast ? ", unproven" : ""})`);
    // The marked row is Super's, and only Super's: the frame around its bar is red (the
    // row itself has no outline), and its number box is marked invalid.
    const marked = await page.evalJs(`(() => { const probe = document.body.appendChild(document.createElement("i")); probe.style.color = "var(--destructive)"; const red = getComputedStyle(probe).color; probe.remove(); return [...document.querySelectorAll("[data-over-max]")].map((r) => { const track = r.querySelector("[data-slot=slider-track]"); return [r.querySelector("input")?.getAttribute("aria-label"), track?.hasAttribute("data-invalid"), getComputedStyle(track, "::before").borderTopColor === red, getComputedStyle(r).outlineStyle]; }); })()`);
    log(`  marked rows: ${JSON.stringify(marked)}`);
    expect(marked.length === 1 && marked[0][0] === "Super target value", "only the Super row is marked");
    expect(marked[0][1] === true && marked[0][2] === true, "the frame around the Super bar is red");
    expect(marked[0][3] === "none", "the row itself has no outline");
    expect((await page.count({ css: "[data-slot=slider-track][data-invalid]" })) === 1, "no other bar is red");
    expect((await page.attr({ role: "spinbutton", name: "Super target value" }, "aria-invalid")) === "true", "the Super number box is aria-invalid");
    // Rows the other targets leave no max read as sitting at their own target ("100 / 100").
    const noMax = await page.evalJs(`["Health", "Melee", "Grenade", "Class", "Weapons"].map((s) => { const input = document.querySelector('input[aria-label="' + s + ' target value"]'); return [s, input.value, input.closest(".space-y-1").querySelector("span[aria-hidden].whitespace-nowrap")?.innerText]; })`);
    log(`  rows with no max: ${JSON.stringify(noMax)}`);
    expect(noMax.every(([, value, inline]) => inline === "/ " + value), "the other five rows read their own target as the max");
    await shot("over-max");

    await page.click({ role: "button", name: `Set Super to ${superMax}` });
    await page.waitFor(async () => (await page.value({ role: "spinbutton", name: "Super target value" })) === String(superMax));
    await page.waitFor(async () => { const v = await superOnCards(); return v.length > 0 && v.every((x) => x >= superMax); }, { timeout: 60000 });
    const status = await settled();
    log(`  after Set Super to ${superMax}: ${status}`);
    expect(COUNT.test(status), `builds are back (${status})`);
    expect((await page.count({ css: "[data-over-max]" })) === 0, "no row is marked any more");
    await shot("over-max-fixed");
  });

  await step("opt-overmax: the Set button works in the phone's builds sheet", async () => {
    await setTarget("Super", 200);
    await page.waitForText(OVER_COPY, { timeout: 60000 });
    await page.s("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    try {
      const bar = { css: '[aria-controls="builds-mobile-sheet"]' };
      await page.waitFor(bar);
      await page.click(bar);
      const sheet = { css: "#builds-mobile-sheet" };
      const fix = { role: "button", name: `Set Super to ${superMax}` };
      await page.waitFor(fix, { within: sheet });
      await shot("over-max-phone", { within: sheet });
      await page.click(fix, { within: sheet });
      // The builds this brings back land in the open sheet.
      await page.waitFor(async () => { const v = await superOnCards(sheet); return v.length > 0 && v.every((x) => x >= superMax); }, { timeout: 60000 });
      expect((await superOnCards(sheet)).length > 0, "builds are listed in the sheet");
      await shot("over-max-phone-fixed", { within: sheet });
      // The sheet hides the page behind it: close it to read the target.
      await page.press("Escape");
      await page.waitFor(sheet, { gone: true });
      expect((await page.value({ role: "spinbutton", name: "Super target value" })) === String(superMax), `Super is set to ${superMax}`);
    } finally {
      await page.s("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    }
  });
}
