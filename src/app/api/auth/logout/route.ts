import { NextResponse } from "next/server";
import { clearSession } from "@/lib/bungie/session";

export const dynamic = "force-dynamic";

// POST only: a GET handler here is logout CSRF — sameSite=lax cookies ride along
// on cross-site top-level navigations, so any page could sign the user out via a link.
export async function POST() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
