// Turns new posts in the Discord feedback forums into issues. Run by a Vercel cron
// (vercel.json). Server-only.
//
// No database: what's already filed is read back from the issues' markers, so the
// check every few minutes doesn't wake Neon. Only recent active posts are considered,
// and a run files at most a handful, so a burst spreads over a few runs.
import {
  activeThreads,
  displayName,
  getChannel,
  getMessage,
  messageUrl,
  sendMessage,
  snowflakeTime,
  DiscordError,
  type DiscordConfig,
  type DiscordForum,
  type DiscordMessage,
  type DiscordThread,
} from "./discord";
import { createIssue, recentIssueBodies, type CreatedIssue, type GithubConfig } from "./github";
import {
  DISCORD_REPLIES,
  FEEDBACK_LABELS,
  discordIssue,
  parseMarkers,
  type FeedbackIssue,
} from "./issue-format";

/** Posts older than this are left alone (and older issues aren't read back). */
const MAX_POST_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FILED_PER_RUN = 5;

export interface SyncDeps {
  threads: () => Promise<DiscordThread[]>;
  forum: (id: string) => Promise<DiscordForum>;
  starter: (thread: DiscordThread) => Promise<DiscordMessage | null>;
  filedChannelIds: () => Promise<Set<string>>;
  file: (issue: FeedbackIssue) => Promise<CreatedIssue>;
  reply: (channelId: string, content: string) => Promise<unknown>;
  guildId: string;
  feedbackChannelIds: string[];
  now: number;
}

export interface SyncResult {
  filed: number[];
  skipped: number;
  pending: number;
}

/** New posts in the feedback forums, oldest first, that have no issue yet. */
export async function syncDiscordFeedback(d: SyncDeps): Promise<SyncResult> {
  const forums = new Set(d.feedbackChannelIds);
  const candidates = (await d.threads())
    .filter((t) => t.parent_id && forums.has(t.parent_id))
    .filter((t) => d.now - snowflakeTime(t.id) < MAX_POST_AGE_MS)
    .sort((a, b) => snowflakeTime(a.id) - snowflakeTime(b.id));
  if (!candidates.length) return { filed: [], skipped: 0, pending: 0 };

  const filed = await d.filedChannelIds();
  const fresh = candidates.filter((t) => !filed.has(t.id));
  const batch = fresh.slice(0, MAX_FILED_PER_RUN);
  const result: SyncResult = { filed: [], skipped: 0, pending: fresh.length - batch.length };

  const tagNames = new Map<string, Map<string, string>>();
  const tagsOf = async (t: DiscordThread) => {
    if (!t.parent_id || !t.applied_tags?.length) return [];
    let names = tagNames.get(t.parent_id);
    if (!names) {
      const forum = await d.forum(t.parent_id);
      names = new Map((forum.available_tags ?? []).map((tag) => [tag.id, tag.name]));
      tagNames.set(t.parent_id, names);
    }
    return t.applied_tags.map((id) => names.get(id)).filter((n): n is string => !!n);
  };

  for (const thread of batch) {
    const starter = await d.starter(thread);
    // A post opened by a bot or webhook (the private bug-report forum's, if it's ever
    // listed by mistake) is ours already.
    if (starter && (starter.author.bot || starter.webhook_id)) {
      result.skipped++;
      continue;
    }
    const issue = await d.file(
      discordIssue({
        threadName: thread.name,
        content: starter?.content ?? "_(the first message was deleted)_",
        authorName: starter ? displayName(starter.author) : "unknown",
        replyChannelId: thread.id,
        url: messageUrl(d.guildId, thread.id),
        tags: await tagsOf(thread),
        attachments: starter?.attachments ?? [],
        where: "Discord forum post",
      }),
    );
    result.filed.push(issue.number);
    // Filed is what matters; the thank-you is best effort.
    await d.reply(thread.id, DISCORD_REPLIES.tracked).catch((err) =>
      console.error("Feedback sync: reply failed:", err instanceof Error ? err.message : err),
    );
  }
  return result;
}

/**
 * The ids of Discord channels (forum threads) that already have an issue. Reads every
 * issue from the window the sync considers: a post's issue is never older than the post.
 */
export async function filedDiscordChannelIds(gh: GithubConfig, now: number): Promise<Set<string>> {
  const issues = await recentIssueBodies(gh, FEEDBACK_LABELS.discord, new Date(now - MAX_POST_AGE_MS));
  const ids = new Set<string>();
  for (const issue of issues) {
    const m = parseMarkers(issue.body);
    if (m.discordChannel && !m.discordMessage) ids.add(m.discordChannel);
  }
  return ids;
}

/** The ids of Discord messages already sent to the tracker by hand. */
export async function filedDiscordMessageIds(gh: GithubConfig): Promise<Set<string>> {
  const issues = await recentIssueBodies(gh, FEEDBACK_LABELS.discord, new Date(Date.now() - MAX_POST_AGE_MS));
  return new Set(issues.map((i) => parseMarkers(i.body).discordMessage).filter((id): id is string => !!id));
}

export function liveSyncDeps(dc: DiscordConfig, gh: GithubConfig): SyncDeps {
  const now = Date.now();
  return {
    threads: () => activeThreads(dc),
    forum: (id) => getChannel<DiscordForum>(dc, id),
    starter: (t) =>
      getMessage(dc, t.id, t.id).catch((err) => {
        if (err instanceof DiscordError && err.status === 404) return null;
        throw err;
      }),
    filedChannelIds: () => filedDiscordChannelIds(gh, now),
    file: (issue) => createIssue(gh, issue),
    reply: (channelId, content) => sendMessage(dc, channelId, content),
    guildId: dc.guildId,
    feedbackChannelIds: dc.feedbackChannelIds,
    now,
  };
}
