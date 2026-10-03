import { NextResponse } from "next/server";
import { setItemLockState } from "bungie-api-ts/destiny2";
import { BungieHttpError, createBungieHttp } from "@/lib/bungie/http";
import { getValidAccessToken, readUser } from "@/lib/bungie/session";
import { bungieErrorResponse } from "@/lib/bungie/equip-route";
import { THROTTLED_MESSAGE, isThrottled, withThrottleRetry } from "@/lib/bungie/throttle";

const isId = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

/**
 * Lock or unlock one item for the inventory manager. Bungie wants a character id with
 * the request (any of the account's characters works, even for vault items).
 * Answers `{ ok: true }` or `{ ok: false, error }`; a dead session is a 401 with `reauth`.
 */
export async function POST(request: Request) {
  const user = await readUser();
  const token = await getValidAccessToken();
  if (!user?.destinyMembershipId || user.destinyMembershipType == null || !token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { itemId?: unknown; characterId?: unknown; locked?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || !isId(body.itemId) || !isId(body.characterId) || typeof body.locked !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { itemId, characterId, locked } = body;

  const http = createBungieHttp(token);
  try {
    await withThrottleRetry(() =>
      setItemLockState(http, {
        state: locked,
        itemId,
        characterId,
        membershipType: user.destinyMembershipType!,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BungieHttpError && err.status === 401) return bungieErrorResponse(err);
    const error = isThrottled(err)
      ? THROTTLED_MESSAGE
      : err instanceof BungieHttpError && err.bungieMessage
        ? err.bungieMessage
        : err instanceof Error
          ? err.message
          : "Lock failed";
    return NextResponse.json({ ok: false, error });
  }
}
