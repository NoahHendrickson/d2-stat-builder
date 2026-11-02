import { describe, expect, it, vi } from "vitest";
import { syncDiscordFeedback, type SyncDeps } from "./discord-sync";
import type { DiscordMessage, DiscordThread } from "./discord";
import { parseMarkers } from "./issue-format";

/** A snowflake for `ms` after Discord's epoch-relative time. */
const at = (ms: number) => String((BigInt(ms) - BigInt(1420070400000)) << BigInt(22));
const NOW = Date.UTC(2026, 10, 2);
const DAY = 24 * 60 * 60 * 1000;

function deps(threads: DiscordThread[], over: Partial<SyncDeps> = {}) {
  const filed: { title: string; body: string; labels: string[] }[] = [];
  const replies: string[] = [];
  const d: SyncDeps = {
    threads: async () => threads,
    forum: async (id) => ({ id, name: "feedback", available_tags: [{ id: "t1", name: "Bug" }] }),
    starter: async (t): Promise<DiscordMessage> => ({
      id: t.id,
      channel_id: t.id,
      content: `body of ${t.name}`,
      author: { id: "u", username: "player" },
      attachments: [],
    }),
    filedChannelIds: async () => new Set(),
    file: async (issue) => {
      filed.push(issue);
      return { number: filed.length, html_url: "" };
    },
    reply: async (channelId) => void replies.push(channelId),
    guildId: "g",
    feedbackChannelIds: ["forum"],
    now: NOW,
    ...over,
  };
  return { d, filed, replies };
}

describe("syncDiscordFeedback", () => {
  it("files new posts in the feedback forums only, oldest first, and thanks them", async () => {
    const newer = { id: at(NOW - DAY), parent_id: "forum", name: "newer", applied_tags: ["t1"] };
    const older = { id: at(NOW - 2 * DAY), parent_id: "forum", name: "older" };
    const elsewhere = { id: at(NOW - DAY), parent_id: "general", name: "elsewhere" };
    const stale = { id: at(NOW - 30 * DAY), parent_id: "forum", name: "stale" };
    const { d, filed, replies } = deps([newer, older, elsewhere, stale]);
    const result = await syncDiscordFeedback(d);
    expect(filed.map((i) => i.title)).toEqual(["older", "newer"]);
    expect(filed[1].labels).toContain("type:bug");
    expect(parseMarkers(filed[0].body)).toEqual({ discordChannel: older.id });
    expect(replies).toEqual([older.id, newer.id]);
    expect(result).toEqual({ filed: [1, 2], skipped: 0, pending: 0 });
  });

  it("skips posts already filed and posts a bot opened", async () => {
    const done = { id: at(NOW - DAY), parent_id: "forum", name: "done" };
    const bot = { id: at(NOW - DAY + 1), parent_id: "forum", name: "bot" };
    const { d, filed } = deps([done, bot], {
      filedChannelIds: async () => new Set([done.id]),
      starter: async (t) => ({
        id: t.id,
        channel_id: t.id,
        content: "",
        author: { id: "b", username: "hook", bot: true },
        attachments: [],
      }),
    });
    expect(await syncDiscordFeedback(d)).toEqual({ filed: [], skipped: 1, pending: 0 });
    expect(filed).toEqual([]);
  });

  it("files a few per run and leaves the rest for the next", async () => {
    const threads = Array.from({ length: 8 }, (_, i) => ({
      id: at(NOW - DAY + i),
      parent_id: "forum",
      name: `p${i}`,
    }));
    const { d } = deps(threads);
    expect(await syncDiscordFeedback(d)).toMatchObject({ pending: 3 });
  });

  it("still files when the thank-you fails", async () => {
    const t = { id: at(NOW - DAY), parent_id: "forum", name: "x" };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, filed } = deps([t], { reply: async () => Promise.reject(new Error("403")) });
    await syncDiscordFeedback(d);
    expect(filed).toHaveLength(1);
    errors.mockRestore();
  });

  it("doesn't read issues when there are no candidates", async () => {
    const filedChannelIds = vi.fn(async () => new Set<string>());
    const { d } = deps([], { filedChannelIds });
    await syncDiscordFeedback(d);
    expect(filedChannelIds).not.toHaveBeenCalled();
  });
});
