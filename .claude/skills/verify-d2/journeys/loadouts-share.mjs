// Saved loadouts (/loadouts): share links. Share copies a short /loadouts#s=<code> link,
// the link opens the import drawer, an unknown code says so, and when the short link
// can't be stored the long #import= link is copied instead and still opens. Same seed
// as loadouts.mjs. See features/loadouts.md (lo-share).
import { meta as loadoutsMeta } from "./loadouts.mjs";
export const meta = loadoutsMeta;

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const menu = async (loadout, item) => {
    await page.click({ role: "button", name: `Actions for ${loadout}` });
    await page.click({ role: "menuitem", name: item });
  };
  const drawer = { role: "dialog", name: "Import shared loadout" };
  const clip = () => page.evalJs("navigator.clipboard.readText()");
  let copied;

  await step("lo-share: Share copies a short link", async () => {
    await app.open("/loadouts");
    const origin = await page.evalJs("location.origin");
    await page.s("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }).catch((e) => log(`grant: ${e.message}`));
    await page.s("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.waitFor({ role: "article", name: "Raid build" });
    await menu("Raid build", "Share");
    const t = await app.toast(/Share link copied/);
    await shot("share-toast");
    const post = stub.last("POST", "/api/loadout-shares");
    expect(post?.status === 200 && post.body?.loadout?.name === "Raid build", "POST /api/loadout-shares carried Raid build");
    copied = await clip();
    log(`copied: ${copied} (${copied.length} chars)`);
    expect(copied === `${origin}/loadouts#s=Share00000`, "clipboard holds the short link");
    expect(/Anyone with the link/i.test(await page.text()), "toast says anyone can import");
  });

  await step("lo-share: the short link opens the import drawer", async () => {
    await page.goto("about:blank");
    await app.open(new URL(copied).pathname + new URL(copied).hash);
    await page.waitFor(drawer, { timeout: 30000 });
    const get = stub.last("GET", "/api/loadout-shares/");
    expect(get?.path === "/api/loadout-shares/Share00000" && get.status === 200, "GET fetched the share");
    expect((await page.value({ role: "textbox", name: "Loadout name" }, { within: drawer })) === "Raid build", "name prefilled");
    await shot("import-drawer");
    await page.click({ role: "button", name: "Import" }, { within: drawer });
    await app.toast(/Loadout imported/);
    const created = stub.last("POST", "/api/loadouts");
    expect(created?.status === 201 && created.body?.loadout?.name === "Raid build", "import saved a copy");
    expect(!(await page.evalJs("location.hash")), "hash cleared after import");
    expect((await page.count({ role: "article", name: "Raid build" })) === 2, "copy listed beside the original");
  });

  await step("lo-share: an unknown code says so", async () => {
    await page.goto("about:blank");
    await app.open("/loadouts#s=Nope000000");
    await app.toast(/doesn't exist/);
    await page.waitForText(/3 Loadouts/i);
    expect(!(await page.exists(drawer)), "no drawer opens");
    expect(!(await page.evalJs("location.hash")), "bad code dropped from the URL");
    await shot("unknown-code");
  });

  await step("lo-share: storage down falls back to the long link", async () => {
    stub.store.sharesDown = true;
    await app.open("/loadouts");
    await page.waitFor({ role: "article", name: "Dungeon build" });
    await menu("Dungeon build", "Share");
    await app.toast(/Share link copied/);
    expect(/Short links aren't available/i.test(await page.text()), "toast explains the long link");
    const long = await clip();
    log(`long link: ${long.length} chars`);
    expect(/\/loadouts#import=/.test(long), "clipboard holds the #import= link");
    copied = long;
  });

  await step("lo-share: old #import= links still open", async () => {
    await page.goto("about:blank");
    await app.open(new URL(copied).pathname + new URL(copied).hash);
    await page.waitFor(drawer, { timeout: 30000 });
    expect((await page.value({ role: "textbox", name: "Loadout name" }, { within: drawer })) === "Dungeon build", "name prefilled from the long link");
    await shot("legacy-drawer");
  });
}
