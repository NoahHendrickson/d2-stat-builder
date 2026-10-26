// Settings (/settings) and synced preferences: theme and site icon (this device only), clearing
// usage history, and a sidebar link that syncs to the account. See features/settings.md.
export const meta = { fixture: "small" };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const theme = () => page.evalJs("document.documentElement.dataset.appTheme ?? null");

  await step("open settings", async () => {
    await app.open("/settings");
    log(`  theme on load: ${await theme()}`);
    await shot("settings");
  });

  await step("set-theme: the Theme radios switch the app theme and persist", async () => {
    const group = { role: "radiogroup", name: "Theme" };
    for (const [radio, attr] of [["Normal", "normal"], ["Scene", null], ["Slate", "slate"]]) {
      await page.click({ role: "radio", name: radio }, { within: group });
      await page.waitFor(async () => (await theme()) === attr);
      expect((await page.attr({ role: "radio", name: radio }, "aria-checked", { within: group })) === "true", `${radio} checked, <html data-app-theme> = ${attr}`);
    }
    await page.click({ role: "radio", name: "Normal" }, { within: group });
    await page.waitFor(async () => (await theme()) === "normal");
    await app.open("/settings");
    expect((await theme()) === "normal", "Normal survives a reload");
    await shot("theme-normal");
  });

  await step("set-icon: a site icon swaps the favicon", async () => {
    await page.click({ role: "radio", name: "Icon 3" }, { within: { role: "radiogroup", name: "Site icon" } });
    const href = await page.waitFor(async () => { const h = await page.evalJs(`document.querySelector('link[rel~="icon"]')?.getAttribute("href")`); return /icon-3/.test(h ?? "") && h; });
    expect(href, `favicon is ${href}`);
  });

  await step("set-usage: Clear history deletes the account's usage", async () => {
    // No confirmation step: one click clears it.
    await page.click({ role: "button", name: "Clear history" });
    await app.toast(/Armor usage history cleared/);
    expect(stub.last("DELETE", "/api/build-usage")?.status === 204, "DELETE /api/build-usage was sent");
  });

  await step("set-sync: a sidebar link is pushed to /api/settings/links", async () => {
    await page.click({ role: "button", name: "Add a link" });
    const dialog = { role: "dialog", name: "Add a link" };
    await page.waitFor(dialog);
    await page.fill({ role: "textbox", name: "URL" }, "https://example.com/verify-d2", { within: dialog });
    await page.fill({ role: "textbox", name: "Name" }, "verify-d2 link", { within: dialog });
    await shot("link-form", { within: dialog });
    await page.click({ role: "button", name: "Add link" }, { within: dialog });
    await page.waitFor(dialog, { gone: true });
    const put = await page.waitFor(() => stub.requests.find((r) => r.method === "PUT" && r.path === "/api/settings/links"), { timeout: 10000 });
    log(`  PUT body: ${JSON.stringify(put.body)}`);
    expect(JSON.stringify(put.body).includes("example.com/verify-d2"), "the pushed links include the new URL");
    expect(stub.store.settings.links?.value?.length === 1, "the stored setting holds one link");
    await page.waitFor({ role: "link", name: /verify-d2/ }, { within: { role: "region", name: "Links" } });
    await shot("link-added");
  });
}
