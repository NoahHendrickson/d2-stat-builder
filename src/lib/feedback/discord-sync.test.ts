import { describe, expect, it, vi } from "vitest";
import { sendToTracker, syncDiscordFeedback, type SyncDeps } from "./discord-sync";
import type { DiscordMessage, DiscordThread } from "./discord";
import { parseMarkers, type FeedbackIssue } from "./issue-format";

/** A snowflake for a time in ms. */
const at = (ms: number) => String((BigInt(ms) - BigInt(1420070400000)) << BigInt(22));
const NOW = Date.UTC(2026, 10, 2);
const DAY = 24 * 60 * 60 * 1000;

const starterOf = (t: DiscordThread, bot = false): DiscordMessage => ({
  id: t.id,
  channel_id: t.id,
  content: `body of ${t.name}`,
  author: { id: "u", username: bot ? "hook" : "player", bot },
  attachments: [],
});

const post = (name: string, ageMs: number, extra: Partial<DiscordThread> = {}): DiscordThread => ({
  id: at(NOW - ageMs),
  parent_id: "forum",
  name,
  ...extra,
});

function deps(threads: DiscordThread[], over: Partial<SyncDeps> = {}) {
  const filed: FeedbackIssue[] = [];
  const d: SyncDeps = {
    guildId: "g",
    threads: async () => threads,
    forums: async () => new Map([["forum", { name: "feature-requests", tags: new Map([["t1", "Bug"]]) }]]),
    starter: async (t) => starterOf(t),
    filedMessageIds: async () => new Set(filed.map((i) => parseMarkers(i.body).discord!.messageId)),
    file: async (issue) => {
      filed.push(issue);
      return { number: filed.length, html_url: `https://github.com/x/y/issues/${filed.length}` };
    },
    now: NOW,
    ...over,
  };
  return { d, filed };
}

describe("syncDiscordFeedback", () => {
  it("files new posts oldest first and tags them", async () => {
    const newer = post("newer", DAY, { applied_tags: ["t1"] });
    const older = post("older", 2 * DAY);
    const stale = post("stale", 30 * DAY);
    const { d, filed } = deps([newer, older, stale]);
    const result = await syncDiscordFeedback(d);
    expect(filed.map((i) => i.title)).toEqual(["older", "newer"]);
    expect(filed[1].labels).toContain("type:bug");
    // Untagged: the forum's name decides.
    expect(filed[0].labels).toContain("type:feature");
    expect(filed[0].body).toContain("#feature-requests forum post");
    expect(parseMarkers(filed[0].body)).toEqual({ discord: { channelId: older.id, messageId: older.id } });
    expect(result).toEqual({ filed: [1, 2], skipped: 0, failed: 0, pending: 0 });
  });

  it("skips posts already filed, and doesn't read tags when nothing is new", async () => {
    const done = post("done", DAY);
    const forums = vi.fn(async () => new Map());
    const { d, filed } = deps([done], { filedMessageIds: async () => new Set([done.id]), forums });
    expect(await syncDiscordFeedback(d)).toEqual({ filed: [], skipped: 0, failed: 0, pending: 0 });
    expect(filed).toEqual([]);
    expect(forums).not.toHaveBeenCalled();
  });

  it("doesn't let skipped bot posts use up the run", async () => {
    const bots = Array.from({ length: 6 }, (_, i) => post(`bot${i}`, 3 * DAY - i));
    const human = post("human", DAY);
    const botIds = new Set(bots.map((b) => b.id));
    const { d, filed } = deps([...bots, human], { starter: async (t) => starterOf(t, botIds.has(t.id)) });
    expect(await syncDiscordFeedback(d)).toMatchObject({ filed: [1], skipped: 6, pending: 0 });
    expect(filed.map((i) => i.title)).toEqual(["human"]);
  });

  it("logs a failing post and carries on with the rest", async () => {
    const bad = post("bad", 2 * DAY);
    const good = post("good", DAY);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, filed } = deps([bad, good], {
      starter: async (t) => (t.id === bad.id ? Promise.reject(new Error("403")) : starterOf(t)),
    });
    expect(await syncDiscordFeedback(d)).toMatchObject({ filed: [1], failed: 1 });
    expect(filed.map((i) => i.title)).toEqual(["good"]);
    errors.mockRestore();
  });

  it("files a few per run and leaves the rest for the next", async () => {
    const threads = Array.from({ length: 8 }, (_, i) => post(`p${i}`, DAY - i));
    const { d } = deps(threads);
    expect(await syncDiscordFeedback(d)).toMatchObject({ pending: 3 });
  });
});

describe("sendToTracker", () => {
  it("files a message once", async () => {
    const message: DiscordMessage = {
      id: "500",
      channel_id: "40",
      content: "the vault is empty",
      author: { id: "u", username: "player" },
      attachments: [],
    };
    const { d, filed } = deps([]);
    const tracker = { ...d, repoName: "feedback" };
    expect(await sendToTracker(tracker, message, "general")).toBe(
      "Filed as feedback#1: https://github.com/x/y/issues/1",
    );
    expect(await sendToTracker(tracker, message, "general")).toBe("That message is already in the tracker.");
    expect(filed).toHaveLength(1);
  });

  it("shares dedupe with the sync: a forum starter is filed once, whichever goes first", async () => {
    const thread = post("starter", DAY);
    const { d, filed } = deps([thread]);
    await sendToTracker({ ...d, repoName: "feedback" }, starterOf(thread));
    await syncDiscordFeedback(d);
    expect(filed).toHaveLength(1);

    const second = deps([thread]);
    await syncDiscordFeedback(second.d);
    expect(await sendToTracker({ ...second.d, repoName: "feedback" }, starterOf(thread))).toBe(
      "That message is already in the tracker.",
    );
    expect(second.filed).toHaveLength(1);
  });
});
