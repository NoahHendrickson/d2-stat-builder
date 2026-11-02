import { NextResponse } from "next/server";
import { discordConfig, sendMessage } from "@/lib/feedback/discord";
import { verifyGithubSignature } from "@/lib/feedback/github";
import { DISCORD_REPLIES, parseMarkers } from "@/lib/feedback/issue-format";

interface IssuesEvent {
  action?: string;
  issue?: { number: number; body: string | null; state_reason?: string | null };
}

/**
 * The feedback repo's webhook (Issues events). When an issue that came from Discord is
 * closed as completed, the bot says so in the original post or under the original
 * message. Closed as not planned or as a duplicate says nothing.
 */
export async function POST(request: Request) {
  const secret = process.env.FEEDBACK_GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyGithubSignature(secret, raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  if (request.headers.get("x-github-event") !== "issues") return NextResponse.json({ ignored: true });

  const event = JSON.parse(raw) as IssuesEvent;
  if (event.action !== "closed" || event.issue?.state_reason !== "completed") {
    return NextResponse.json({ ignored: true });
  }
  const { discordChannel, discordMessage } = parseMarkers(event.issue.body);
  const dc = discordConfig();
  if (!discordChannel || !dc) return NextResponse.json({ ignored: true });
  try {
    await sendMessage(dc, discordChannel, DISCORD_REPLIES.fixed, discordMessage);
  } catch (err) {
    // A deleted post or message: nothing to tell anyone. Answer 200 so GitHub doesn't retry.
    console.error(`Fixed reply for #${event.issue.number} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ replied: false });
  }
  return NextResponse.json({ replied: true });
}
