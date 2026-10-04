import { NextResponse } from "next/server";
import { readUser } from "@/lib/bungie/session";
import { isSettingKey, parseSettingValue } from "@/lib/settings/keys";
import { getServerSettingsStore } from "@/lib/settings/neon-store";
import { notConfigured, storageError } from "@/lib/loadouts/api-responses";
import { rejectCrossSite } from "@/lib/http/same-origin";

/** Settings are small lists; anything bigger is not something this app wrote. */
const MAX_BODY_LENGTH = 64 * 1024;

type Ctx = { params: Promise<{ key: string }> };

/** Replace one synced setting. Body: `{ value }`. Answers `{ value, updatedAt }`. */
export async function PUT(request: Request, { params }: Ctx) {
  const refused = rejectCrossSite(request);
  if (refused) return refused;
  const user = await readUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const store = getServerSettingsStore();
  if (!store) return notConfigured();

  const { key } = await params;
  if (!isSettingKey(key)) {
    return NextResponse.json({ error: "Unknown setting" }, { status: 404 });
  }
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: "Setting too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const value =
    body && typeof body === "object"
      ? parseSettingValue(key, (body as { value?: unknown }).value)
      : null;
  if (!value) return NextResponse.json({ error: "Invalid setting" }, { status: 400 });

  try {
    return NextResponse.json(await store.put(user.membershipId, key, value));
  } catch (err) {
    return storageError(err);
  }
}
