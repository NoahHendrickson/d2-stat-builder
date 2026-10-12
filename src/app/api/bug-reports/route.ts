import { after, NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { decodeBugReport } from "@/lib/bug-reports/bug-report";
import { getServerBugReportStore, type NewBugReport } from "@/lib/bug-reports/neon-store";
import { bugReportWebhookUrl, postBugReportToDiscord } from "@/lib/bug-reports/discord-webhook";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

/** A 4000-character description, with room for JSON escaping and the context. */
const MAX_BODY_LENGTH = 32 * 1024;
const WHAT = "Bug report";

/**
 * Save a signed-in account's bug report, then post it to Discord when a webhook is set.
 * Body: `{ title, description, context, website }` (see `decodeBugReport`).
 */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerBugReportStore();
  if (!store) return notConfigured(WHAT);

  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Report too long" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const input = decodeBugReport(body);
  if (!input) return NextResponse.json({ error: "Add a title and a description" }, { status: 400 });
  // The honeypot: only a bot fills a field nobody can see. Tell it everything went fine.
  if (input.website) return new NextResponse(null, { status: 204 });

  const report: NewBugReport = {
    title: input.title,
    description: input.description,
    context: input.context,
    userAgent: (request.headers.get("user-agent") ?? "").slice(0, 500),
    host: request.headers.get("host") ?? "",
    build: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7),
    membershipId: user.membershipId,
    displayName: user.displayName ?? null,
  };

  let id: string | null;
  try {
    id = await store.add(report);
  } catch (err) {
    return storageError(err, WHAT);
  }
  if (!id) {
    return NextResponse.json(
      { error: "Too many reports right now — try again in a bit" },
      { status: 429 },
    );
  }

  const webhook = bugReportWebhookUrl();
  if (webhook) {
    // Saved already; Discord is only the notification, so it doesn't hold up the answer.
    after(() =>
      postBugReportToDiscord(webhook, id, report).catch((err) =>
        console.error("Bug report webhook failed:", err instanceof Error ? err.message : err),
      ),
    );
  }
  return NextResponse.json({ id }, { status: 201 });
}
