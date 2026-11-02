// Send feedback: features/feedback.md.
export const meta = { fixture: "small" };

export default async function ({ page, app, stub, step, shot, expect, log }) {
  const dialog = { role: "dialog", name: "Send feedback" };
  const checked = async (name) => (await page.attr({ role: "radio", name, within: dialog }, "aria-checked")) === "true";

  await step("fb-open: the sidebar button opens Send feedback on Bug", async () => {
    await app.open("/");
    await page.click({ role: "button", name: "Send feedback" });
    await page.waitFor(dialog);
    expect(await page.exists({ role: "radiogroup", name: "Kind of feedback", within: dialog }), "Bug / Idea is a radio group");
    expect(await checked("Bug"), "Bug is selected");
    expect(await page.exists({ role: "textbox", name: "What happened?", within: dialog }), "bug wording");
    await shot("bug", { within: dialog });
  });

  await step("fb-kind: Idea changes the wording", async () => {
    await page.click({ role: "radio", name: "Idea", within: dialog });
    await page.waitFor({ role: "textbox", name: "What's your idea?", within: dialog });
    expect(await checked("Idea"), "Idea is selected");
    expect(!(await checked("Bug")), "Bug is no longer selected");
    const placeholder = await page.attr({ role: "textbox", name: "What's your idea?" }, "placeholder");
    expect(/how it would help/.test(placeholder ?? ""), `idea placeholder: ${placeholder}`);
    await page.fill({ role: "textbox", name: "Title", within: dialog }, "Collapse other characters");
    await page.fill({ role: "textbox", name: "What's your idea?", within: dialog }, "Hide the other two characters on Items.");
    await shot("idea", { within: dialog });
  });

  await step("fb-send: sending posts the kind and resets the draft", async () => {
    await page.click({ role: "button", name: "Send", within: dialog });
    await app.toast(/feedback was sent/i);
    const body = stub.last("POST", "/api/bug-reports")?.body;
    log(JSON.stringify(body));
    expect(body?.kind === "idea", "POST carried kind: idea");
    expect(body?.title === "Collapse other characters", "POST carried the title");
    await page.waitFor(dialog, { gone: true });
    await page.click({ role: "button", name: "Send feedback" });
    await page.waitFor(dialog);
    expect(await checked("Bug"), "a fresh draft starts on Bug");
    expect((await page.value({ role: "textbox", name: "Title", within: dialog })) === "", "the title is empty");
    await shot("after-send", { within: dialog });
  });
}
