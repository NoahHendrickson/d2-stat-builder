import { after, NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { decodeBugReport } from "@/lib/bug-reports/bug-report";
import { getServerBugReportStore, type NewBugReport } from "@/lib/bug-reports/neon-store";
import { notifyBugReport } from "@/lib/bug-reports/notify";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

/** A 4000-character description, with room for JSON escaping and the context. */
const MAX_BODY_BYTES = 32 * 1024;
const WHAT = "Feedback";

/**
 * Save a signed-in account's feedback (a bug or an idea), then file it as an issue in the
 * feedback repo and post it to Discord, when each is configured.
 * Body: `{ kind, title, description, context }` (see `decodeBugReport`).
 */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerBugReportStore();
  if (!store) return notConfigured(WHAT);

  // Refuse an oversized body from its header before buffering it; the byte check after
  // covers a request that didn't declare its length.
  const tooLarge = () => NextResponse.json({ error: "That's too long" }, { status: 413 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const bytes = await request.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (bytes.byteLength > MAX_BODY_BYTES) return tooLarge();
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    body = null;
  }
  const input = decodeBugReport(body);
  if (!input) return NextResponse.json({ error: "Add a title and a description" }, { status: 400 });

  const report: NewBugReport = {
    kind: input.kind,
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
      { error: "Too much feedback right now — try again in a bit" },
      { status: 429 },
    );
  }

  // Saved already; filing the issue and the Discord post don't hold up the answer.
  after(() => notifyBugReport(id, report));
  return NextResponse.json({ id }, { status: 201 });
}
