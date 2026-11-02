import { connection, NextResponse } from "next/server";
import { errorText } from "@/lib/error-text";
import { safeEqual } from "@/lib/http/safe-equal";
import { discordConfig } from "@/lib/feedback/discord";
import { githubConfig } from "@/lib/feedback/github";
import { liveSyncDeps, syncDiscordFeedback } from "@/lib/feedback/discord-sync";

/**
 * Only the deployment built from main files anything. The canary project deploys the
 * same cron from `canary`, and two syncs racing would file every post twice.
 */
const isMainDeployment = () => !process.env.VERCEL || process.env.VERCEL_GIT_COMMIT_REF === "main";

/**
 * File new Discord feedback-forum posts as issues in the feedback repo. Called by the
 * cron in vercel.json (`Authorization: Bearer $CRON_SECRET`); does nothing until the bot
 * and GitHub token are configured. Never touches Neon.
 */
export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  if (!isMainDeployment()) return NextResponse.json({ skipped: "not the main deployment" });
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
    console.error("Feedback sync failed:", errorText(err));
    return NextResponse.json({ error: "Sync failed" }, { status: 502 });
  }
}
