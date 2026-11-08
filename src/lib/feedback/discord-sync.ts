// The two ways Discord feedback becomes an issue. Server-only.
//
// - `syncDiscordFeedback`: new posts in the feedback forums, run by a Vercel cron
//   (vercel.json).
// - `sendToTracker`: one message a moderator picked with "Send to tracker".
//
// Both dedupe on the source message id read back from issue markers (a forum post's
// starter message has the thread's id), so they see each other's filings. No database:
// the check every few minutes doesn't wake Neon.
import { errorText } from "@/lib/error-text";
import {
  DiscordError,
  feedbackThreads,
  getChannel,
  getMessage,
  snowflakeTime,
  type DiscordConfig,
  type DiscordForum,
  type DiscordMessage,
  type DiscordThread,
} from "./discord";
import { createIssue, recentIssueBodies, type CreatedIssue, type GithubConfig } from "./github";
import { forumPostIssue, messageIssue, parseMarkers, type FeedbackIssue } from "./issue-format";

/** Posts older than this are left alone, and issues older than this aren't read back. */
const MAX_POST_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Issues filed per sync run, so a burst spreads over a few runs. */
const MAX_FILED_PER_RUN = 5;
/** Posts looked at per run, so skipped or failing posts can't make a run slow. */
const MAX_EXAMINED_PER_RUN = 25;

export interface FileDeps {
  guildId: string;
  /** Source message ids that already have an issue. */
  filedMessageIds: () => Promise<Set<string>>;
  file: (issue: FeedbackIssue) => Promise<CreatedIssue>;
}

export interface SyncDeps extends FileDeps {
  threads: () => Promise<DiscordThread[]>;
  /** Each feedback forum's name and tag id → name. */
  forums: () => Promise<Map<string, { name: string; tags: Map<string, string> }>>;
  /** A post's starter message, or null when it was deleted. */
  starter: (thread: DiscordThread) => Promise<DiscordMessage | null>;
  now: number;
}

export interface SyncResult {
  filed: number[];
  skipped: number;
  failed: number;
  pending: number;
}

/** New posts in the feedback forums, oldest first, that have no issue yet. */
export async function syncDiscordFeedback(d: SyncDeps): Promise<SyncResult> {
  const candidates = (await d.threads())
    .filter((t) => d.now - snowflakeTime(t.id) < MAX_POST_AGE_MS)
    .sort((a, b) => snowflakeTime(a.id) - snowflakeTime(b.id));
  const result: SyncResult = { filed: [], skipped: 0, failed: 0, pending: 0 };
  if (!candidates.length) return result;

  const filed = await d.filedMessageIds();
  const fresh = candidates.filter((t) => !filed.has(t.id));
  if (!fresh.length) return result;
  const forums = await d.forums();

  let examined = 0;
  for (const thread of fresh) {
    if (result.filed.length >= MAX_FILED_PER_RUN || examined >= MAX_EXAMINED_PER_RUN) break;
    examined++;
    try {
      const starter = await d.starter(thread);
      // Deleted, or opened by a bot or webhook (the private bug-report forum's, if it's
      // ever listed by mistake): nothing a player is waiting on.
      if (!starter || starter.author.bot || starter.webhook_id) {
        result.skipped++;
        continue;
      }
      const forum = thread.parent_id ? forums.get(thread.parent_id) : undefined;
      const tagNames = (thread.applied_tags ?? []).flatMap((id) => forum?.tags.get(id) ?? []);
      const issue = await d.file(forumPostIssue(d.guildId, thread, starter, forum?.name ?? "", tagNames));
      result.filed.push(issue.number);
    } catch (err) {
      // One bad post (no access, a refused issue) mustn't hold up the rest on every run.
      console.error(`Feedback sync: post ${thread.id} failed:`, errorText(err));
      result.failed++;
    }
  }
  result.pending = fresh.length - examined;
  return result;
}

/** "Send to tracker" on one message. The text to show the moderator who sent it. */
export async function sendToTracker(
  d: FileDeps & { repoName: string },
  message: DiscordMessage,
  channelName?: string,
): Promise<string> {
  if ((await d.filedMessageIds()).has(message.id)) return "That message is already in the tracker.";
  const issue = await d.file(messageIssue(d.guildId, message, channelName));
  return `Filed as ${d.repoName}#${issue.number}: ${issue.html_url}`;
}

/**
 * Source message ids of every issue from the window the sync considers: a post's issue
 * is never older than the post.
 */
export async function filedDiscordMessageIds(gh: GithubConfig, now = Date.now()): Promise<Set<string>> {
  const issues = await recentIssueBodies(gh, new Date(now - MAX_POST_AGE_MS));
  return new Set(issues.flatMap((i) => parseMarkers(i.body).discord?.messageId ?? []));
}

export function liveFileDeps(dc: DiscordConfig, gh: GithubConfig): FileDeps {
  return {
    guildId: dc.guildId,
    filedMessageIds: () => filedDiscordMessageIds(gh),
    file: (issue) => createIssue(gh, issue),
  };
}

export function liveSyncDeps(dc: DiscordConfig, gh: GithubConfig): SyncDeps {
  return {
    ...liveFileDeps(dc, gh),
    threads: () => feedbackThreads(dc),
    forums: async () => {
      const forums = await Promise.all(
        dc.feedbackChannelIds.map((id) => getChannel<DiscordForum>(dc, id)),
      );
      return new Map(
        forums.map((f) => [
          f.id,
          { name: f.name, tags: new Map((f.available_tags ?? []).map((t) => [t.id, t.name])) },
        ]),
      );
    },
    starter: (t) =>
      getMessage(dc, t.id, t.id).catch((err) => {
        if (err instanceof DiscordError && err.status === 404) return null;
        throw err;
      }),
    now: Date.now(),
  };
}
