import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { rejectCrossSite } from "@/lib/http/same-origin";
import { getApplyCancelStore, isApplyId } from "@/lib/loadouts/apply-cancel-store";

/**
 * Stop a running apply: flags `applyId` for the signed-in account. The apply route
 * checks the flag between Bungie calls, finishes the step it's on, and reports
 * `cancelled` on its stream.
 */
export async function POST(request: Request) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let applyId: unknown;
  try {
    applyId = ((await request.json()) as { applyId?: unknown } | null)?.applyId;
  } catch {
    applyId = undefined;
  }
  if (!isApplyId(applyId)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    await getApplyCancelStore().cancel(user.membershipId, applyId);
  } catch {
    return NextResponse.json({ error: "Couldn't cancel — try again" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
