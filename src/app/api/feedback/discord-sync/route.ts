import { connection, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { discordConfig } from "@/lib/feedback/discord";
import { githubConfig } from "@/lib/feedback/github";
import { liveSyncDeps, syncDiscordFeedback } from "@/lib/feedback/discord-sync";

/** Vercel cron sends `Authorization: Bearer $CRON_SECRET`. */
function fromCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * File new Discord feedback-forum posts as issues in the feedback repo. Called by the
 * cron in vercel.json; does nothing until the bot and GitHub token are configured (so
 * the canary project's copy of the cron is a no-op). Never touches Neon.
 */
export async function GET(request: Request) {
  await connection();
  if (!fromCron(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const dc = discordConfig();
  const gh = githubConfig();
  if (!dc || !gh || !dc.feedbackChannelIds.length) {
    return NextResponse.json({ skipped: "not configured" });
  }
  try {
    const result = await syncDiscordFeedback(liveSyncDeps(dc, gh));
    if (result.filed.length) console.log(`Feedback sync filed issues ${result.filed.join(", ")}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Feedback sync failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sync failed" }, { status: 502 });
  }
}
