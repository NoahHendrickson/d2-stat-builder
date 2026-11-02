import { NextResponse } from "next/server";
import { errorText } from "@/lib/error-text";
import { discordConfig, sendMessage } from "@/lib/feedback/discord";
import { addLabel, githubConfig, issueLabels, verifyGithubSignature } from "@/lib/feedback/github";
import { DISCORD_REPLIES, FEEDBACK_LABELS, parseMarkers } from "@/lib/feedback/issue-format";

interface IssuesEvent {
  action?: string;
  issue?: { number: number; body: string | null; state_reason?: string | null };
}

/**
 * The feedback repo's webhook (Issues events). When an issue that came from Discord is
 * closed as completed, the bot says so under the original message, once: the issue then
 * gets `discord-notified`, read fresh from GitHub, so a re-close or a replayed delivery
 * stays quiet. Closing as not planned or as a duplicate says nothing.
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
  const source = parseMarkers(event.issue.body).discord;
  const dc = discordConfig();
  const gh = githubConfig();
  if (!source || !dc || !gh) return NextResponse.json({ ignored: true });
  const issue = event.issue.number;
  try {
    if ((await issueLabels(gh, issue)).includes(FEEDBACK_LABELS.notified)) {
      return NextResponse.json({ ignored: "already told" });
    }
    await addLabel(gh, issue, FEEDBACK_LABELS.notified);
  } catch (err) {
    console.error(`Fixed reply for #${issue}: label check failed:`, errorText(err));
    return NextResponse.json({ error: "GitHub failed" }, { status: 502 });
  }
  try {
    await sendMessage(dc, source.channelId, DISCORD_REPLIES.fixed, source.messageId);
  } catch (err) {
    // A deleted post or message: nothing to tell anyone. Answer 200 so GitHub doesn't retry.
    console.error(`Fixed reply for #${issue} failed:`, errorText(err));
    return NextResponse.json({ replied: false });
  }
  return NextResponse.json({ replied: true });
}
