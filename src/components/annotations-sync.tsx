"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";
import { loadAnnotations } from "@/lib/inventory/annotations";

/**
 * Points the item tag and notes store at the signed-in account, once for the whole app:
 * every page that shows or sets a tag (Items, the Armor table, build cards) reads the
 * same store, and `setTag` only persists once it knows the account. Renders nothing.
 */
export function AnnotationsSync() {
  const membershipId = sessionMembershipId(useSession().data);
  useEffect(() => loadAnnotations(membershipId), [membershipId]);
  return null;
}
