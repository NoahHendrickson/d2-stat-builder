"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { HugeiconsIcon } from "@hugeicons/react";
import { ShoppingCartAdd02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { DetailSection } from "@/components/detail-card";
import { fetchProfile, newerProfile } from "@/lib/armory/fetch";
import { profileKey } from "@/lib/armory/keys";
import { toast } from "@/lib/toast";
import type { WeaponCatalog } from "@/lib/weapons/catalog";
import type { PickSlot, Roll } from "@/lib/weapons/pick-slots";
import type { WeaponSummary } from "@/lib/weapons/types";
import { farmWeaponFromPicks, farmWeaponPicksKey, matchingCopies, placeLabel, sameFarmWeapon, type OwnedCopy } from "@/lib/farm-list/match";
import { isFarmDone } from "@/lib/farm-list/types";
import { useFarmList, useFarmListMutations } from "@/lib/farm-list/use-farm-list";
import { useSession } from "@/lib/auth/use-session";
import { sessionMembershipId } from "@/lib/armory/use-profile";

/** How old a held profile may be and still answer "do you own it?". */
const PROFILE_FRESH_MS = 30_000;

/**
 * The Perks section. Once a left and a right perk are picked, its header offers to add the
 * roll to the Farm list, unless a copy with everything picked is already owned, in which
 * case the section says where and offers to add it anyway (that copy then never counts as
 * the drop). Once the roll is on the list, the button takes it off again. Not shown on
 * craftable weapons.
 */
export function FarmPerksSection({
  weapon,
  catalog,
  slots,
  picked,
  children,
}: {
  weapon: WeaponSummary;
  catalog: WeaponCatalog;
  slots: readonly PickSlot[];
  picked: Roll;
  children: ReactNode;
}) {
  const membershipId = sessionMembershipId(useSession().data);
  const queryClient = useQueryClient();
  const entries = useFarmList().data;
  const { add, remove } = useFarmListMutations();
  const entry = useMemo(
    () => farmWeaponFromPicks(weapon, catalog.perks, catalog.allWeapons, slots, picked),
    [weapon, catalog, slots, picked],
  );
  const existing = entry ? entries?.find((w) => w.kind === "weapon" && !isFarmDone(w) && sameFarmWeapon(w, entry)) : undefined;
  // Copies already owned, for the picks they were found for.
  const [owned, setOwned] = useState<{ key: string; profile: DestinyProfileResponse; copies: OwnedCopy[] } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const canAdd = entry !== null && membershipId !== undefined;
  const key = entry ? farmWeaponPicksKey(entry) : "";
  const ownedNow = owned?.key === key ? owned : null;
  const busy = checking || add.isPending || remove.isPending;

  function save(ignoredInstanceIds: string[] = []) {
    add.mutate(
      { ...entry!, ignoredInstanceIds },
      {
        onSuccess: () => {
          setOwned(null);
          toast.success("Added to your Farm list");
        },
        onError: (err) => toast.error("Couldn't add to your Farm list", err.message),
      },
    );
  }

  async function check() {
    setChecking(true);
    try {
      const profile = await queryClient.fetchQuery<DestinyProfileResponse>({
        queryKey: profileKey(membershipId),
        staleTime: PROFILE_FRESH_MS,
        queryFn: async () => {
          const held = queryClient.getQueryData<DestinyProfileResponse>(profileKey(membershipId));
          return newerProfile(held, await fetchProfile(held));
        },
      });
      const copies = matchingCopies(profile, entry!);
      if (copies.length > 0) setOwned({ key, profile, copies });
      else save();
    } catch {
      toast.error("Couldn't check your vault", "Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

  const action = !canAdd ? undefined : existing ? (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      aria-pressed
      onClick={() =>
        remove.mutate(existing.id, {
          onError: (err) => toast.error("Couldn't remove it from your Farm list", err.message),
        })
      }
    >
      <HugeiconsIcon icon={ShoppingCartAdd02Icon} aria-hidden />
      On your Farm list
    </Button>
  ) : (
    <Button size="sm" variant="outline" disabled={busy || ownedNow !== null} onClick={() => void check()}>
      <HugeiconsIcon icon={ShoppingCartAdd02Icon} aria-hidden />
      {checking ? "Checking your vault…" : "Add to Farm list"}
    </Button>
  );

  return (
    <DetailSection
      title="Perks"
      // As tall as the button, so the grid doesn't jump when it appears.
      heading={<span className="flex min-h-7 items-center">Perks</span>}
      action={action}
    >
      {children}
      {ownedNow && !existing && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-muted-foreground">
            You already have this roll {placeLabel(ownedNow.profile, ownedNow.copies[0]!.place)}.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => save(ownedNow.copies.map((c) => c.instanceId))}
          >
            Add anyway
          </Button>
        </div>
      )}
    </DetailSection>
  );
}
