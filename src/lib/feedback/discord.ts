// The D2 Conflux Discord bot, over plain REST (no gateway connection, so it runs on
// serverless functions). Server-only.
//
// DISCORD_BOT_TOKEN       the bot's token (Developer Portal → Bot).
// DISCORD_APP_ID          the application id.
// DISCORD_PUBLIC_KEY      the application's public key, for verifying interactions.
// DISCORD_GUILD_ID        the D2 Conflux server.
// DISCORD_FEEDBACK_CHANNEL_IDS  comma-separated forum channels whose posts become issues.
import { createPublicKey, verify } from "node:crypto";

const API = "https://discord.com/api/v10";
/** Discord's epoch (2015-01-01), for reading a snowflake's time. */
const DISCORD_EPOCH = BigInt(1420070400000);
/** Interactions older than this are refused, so a captured request can't be replayed. */
const MAX_INTERACTION_AGE_S = 5 * 60;

export interface DiscordConfig {
  botToken: string;
  guildId: string;
  feedbackChannelIds: string[];
}

export function discordConfig(): DiscordConfig | null {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return null;
  const feedbackChannelIds = (process.env.DISCORD_FEEDBACK_CHANNEL_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { botToken, guildId, feedbackChannelIds };
}

/**
 * The message context-menu command, as registered by scripts/register-discord-commands.ts.
 * Only members who can Manage Messages see it (server settings can widen that).
 */
export const TRACKER_COMMAND = {
  name: "Send to tracker",
  /** MESSAGE: right-click a message → Apps. */
  type: 3,
  default_member_permissions: String(1 << 13),
} as const;

export const snowflakeTime = (id: string) => Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH);

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One Discord request. `token` null sends none (interaction webhooks carry their own). */
async function discord<T>(token: string | null, path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bot ${token}` } : {}),
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://d2conflux.com, 1)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 && attempt === 0) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(body.retry_after ?? 1, 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DiscordError(res.status, `Discord ${init?.method ?? "GET"} ${path} answered ${res.status} ${text.slice(0, 200)}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: DiscordUser;
  webhook_id?: string;
  attachments: { filename: string; url: string }[];
}

export interface DiscordThread {
  id: string;
  parent_id?: string;
  name: string;
  applied_tags?: string[];
}

export interface DiscordForum {
  id: string;
  name: string;
  available_tags?: { id: string; name: string }[];
}

export const displayName = (u: DiscordUser) => u.global_name || u.username;

export const messageUrl = (guildId: string, channelId: string, messageId?: string) =>
  `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ""}`;

/**
 * Posts in the feedback forums: every active one, plus the newest archived ones, so a
 * post that archived before a sync ran isn't missed.
 */
export async function feedbackThreads(c: DiscordConfig): Promise<DiscordThread[]> {
  const [active, ...archived] = await Promise.all([
    discord<{ threads: DiscordThread[] }>(c.botToken, `/guilds/${c.guildId}/threads/active`),
    ...c.feedbackChannelIds.map((id) =>
      discord<{ threads: DiscordThread[] }>(c.botToken, `/channels/${id}/threads/archived/public?limit=50`),
    ),
  ]);
  const forums = new Set(c.feedbackChannelIds);
  const byId = new Map<string, DiscordThread>();
  for (const t of [active, ...archived].flatMap((r) => r.threads)) {
    if (t.parent_id && forums.has(t.parent_id)) byId.set(t.id, t);
  }
  return [...byId.values()];
}

export const getChannel = <T>(c: DiscordConfig, id: string) => discord<T>(c.botToken, `/channels/${id}`);

/** A forum post's first message has the thread's id. */
export const getMessage = (c: DiscordConfig, channelId: string, messageId: string) =>
  discord<DiscordMessage>(c.botToken, `/channels/${channelId}/messages/${messageId}`);

/** Post as the bot. Nothing it says pings anyone. */
export function sendMessage(c: DiscordConfig, channelId: string, content: string, replyTo?: string) {
  return discord<DiscordMessage>(c.botToken, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [], replied_user: false },
      ...(replyTo ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}),
    }),
  });
}

/** Replace the "thinking…" placeholder of a deferred interaction reply. */
export function editInteractionReply(appId: string, interactionToken: string, content: string) {
  return discord<unknown>(null, `/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
}

/** DER prefix that turns a raw 32-byte Ed25519 key into SPKI. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Checks an interaction's `X-Signature-Ed25519` over timestamp + raw body. */
export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | null,
  timestamp: string | null,
  rawBody: string,
  nowS = Date.now() / 1000,
): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  if (!(Math.abs(nowS - Number(timestamp)) <= MAX_INTERACTION_AGE_S)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}
