import { after, NextResponse } from "next/server";
import {
  discordConfig,
  displayName,
  editInteractionReply,
  messageUrl,
  sendMessage,
  SEND_TO_TRACKER,
  verifyDiscordSignature,
  type DiscordMessage,
} from "@/lib/feedback/discord";
import { filedDiscordMessageIds } from "@/lib/feedback/discord-sync";
import { createIssue, githubConfig } from "@/lib/feedback/github";
import { DISCORD_REPLIES, discordIssue } from "@/lib/feedback/issue-format";

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMMAND = 3;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

interface Interaction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  token: string;
  channel?: { name?: string };
  data?: {
    type?: number;
    name?: string;
    target_id?: string;
    resolved?: { messages?: Record<string, DiscordMessage> };
  };
}

const privately = (content: string) =>
  NextResponse.json({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } });

/**
 * Discord's interactions endpoint. Handles "Send to tracker" (right-click a message →
 * Apps): files that message as an issue and tells only the person who clicked. The
 * command is limited to members who can manage messages when it's registered.
 */
export async function POST(request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const appId = process.env.DISCORD_APP_ID;
  if (!publicKey || !appId) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  const ok = verifyDiscordSignature(
    publicKey,
    request.headers.get("x-signature-ed25519"),
    request.headers.get("x-signature-timestamp"),
    raw,
  );
  if (!ok) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  const interaction = JSON.parse(raw) as Interaction;
  if (interaction.type === PING) return NextResponse.json({ type: PONG });
  if (
    interaction.type !== APPLICATION_COMMAND ||
    interaction.data?.type !== MESSAGE_COMMAND ||
    interaction.data.name !== SEND_TO_TRACKER
  ) {
    return privately("I don't know that command.");
  }

  const dc = discordConfig();
  const gh = githubConfig();
  if (!dc || !gh) return privately("The tracker isn't set up yet.");
  if (interaction.guild_id !== dc.guildId) return privately("This only works in the D2 Conflux server.");
  const target = interaction.data.target_id;
  const message = target ? interaction.data.resolved?.messages?.[target] : undefined;
  if (!message) return privately("Couldn't read that message.");

  // Filing takes longer than Discord's 3 seconds allow, so answer "thinking…" and finish after.
  after(async () => {
    const say = (content: string) =>
      editInteractionReply(appId, interaction.token, content).catch((err) =>
        console.error("Send to tracker: reply failed:", err instanceof Error ? err.message : err),
      );
    try {
      if ((await filedDiscordMessageIds(gh)).has(message.id)) {
        await say("That message is already in the tracker.");
        return;
      }
      const channelName = interaction.channel?.name;
      const issue = await createIssue(
        gh,
        discordIssue({
          threadName: "",
          content: message.content,
          authorName: displayName(message.author),
          replyChannelId: message.channel_id,
          replyMessageId: message.id,
          url: messageUrl(dc.guildId, message.channel_id, message.id),
          tags: [],
          attachments: message.attachments ?? [],
          where: channelName ? `Sent to tracker from #${channelName}` : "Sent to tracker",
        }),
      );
      await sendMessage(dc, message.channel_id, DISCORD_REPLIES.tracked, message.id).catch(() => {});
      await say(`Filed as ${gh.repo.split("/")[1]}#${issue.number}: ${issue.html_url}`);
    } catch (err) {
      console.error("Send to tracker failed:", err instanceof Error ? err.message : err);
      await say("Couldn't file that. Try again in a minute.");
    }
  });
  return NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
}
