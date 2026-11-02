import { after, NextResponse } from "next/server";
import { errorText } from "@/lib/error-text";
import {
  discordConfig,
  editInteractionReply,
  TRACKER_COMMAND,
  verifyDiscordSignature,
  type DiscordMessage,
} from "@/lib/feedback/discord";
import { liveFileDeps, sendToTracker } from "@/lib/feedback/discord-sync";
import { githubConfig } from "@/lib/feedback/github";

const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const DEFERRED_CHANNEL_MESSAGE = 5;
const EPHEMERAL = 64;

interface Interaction {
  type: number;
  guild_id?: string;
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
 * Apps): files that message as an issue and tells only the person who clicked.
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
    interaction.data?.type !== TRACKER_COMMAND.type ||
    interaction.data.name !== TRACKER_COMMAND.name
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
    const text = await sendToTracker(
      { ...liveFileDeps(dc, gh), repoName: gh.repoName },
      message,
      interaction.channel?.name,
    ).catch((err) => {
      console.error("Send to tracker failed:", errorText(err));
      return "Couldn't file that. Try again in a minute.";
    });
    await editInteractionReply(appId, interaction.token, text).catch((err) =>
      console.error("Send to tracker: reply failed:", errorText(err)),
    );
  });
  return NextResponse.json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
}
