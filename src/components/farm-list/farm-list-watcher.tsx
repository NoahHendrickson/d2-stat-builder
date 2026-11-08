"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useArmory } from "@/lib/armory/use-armory";
import { useProfile } from "@/lib/armory/use-profile";
import { toast } from "@/lib/toast";
import { armorFarmTitle, armorPlaceLabel, newlyObtainedArmor } from "@/lib/farm-list/armor";
import { dismantledDrops, newlyObtained, placeLabel } from "@/lib/farm-list/match";
import { isFarmDone, type ArmorFarmEntry, type FarmEntry, type WeaponFarmEntry } from "@/lib/farm-list/types";
import { useFarmList, useFarmListMutations } from "@/lib/farm-list/use-farm-list";

/**
 * Watches for Farm list drops: whenever the profile comes in (on load, back to the tab
 * once it's gone stale, or a page's own refresh), any waiting entry with a matching copy is marked obtained and
 * a toast says so. Only drops seen while the app is open count; a copy dismantled before
 * then is never seen. Renders nothing.
 */
export function FarmListWatcher() {
  const entries = useFarmList().data;
  const weapons = useMemo(
    () => entries?.filter((e): e is WeaponFarmEntry => e.kind === "weapon") ?? [],
    [entries],
  );
  const armor = useMemo(
    () => entries?.filter((e): e is ArmorFarmEntry => e.kind === "armor") ?? [],
    [entries],
  );
  const dropped = useMemo(() => entries?.filter((e) => e.obtained && !isFarmDone(e)) ?? [], [entries]);
  // The profile and armory are only read while there's something to wait for.
  return (
    <>
      {dropped.length > 0 && <DismantledWatch dropped={dropped} />}
      {weapons.some((e) => !e.obtained) && <WeaponWatch entries={weapons} />}
      {armor.some((e) => !e.obtained) && <ArmorWatch entries={armor} />}
    </>
  );
}

/**
 * Sends each match once. The promise, not mutate's callbacks: a match can empty the
 * waiting list, which unmounts the watcher before callbacks would run.
 */
function useReportDrop() {
  const send = useFarmListMutations().patch.mutateAsync;
  // Matches already sent, so a re-render before the list updates doesn't send twice.
  const sent = useRef(new Set<string>());
  return useCallback(
    (entry: FarmEntry, instanceId: string, onSaved: () => void) => {
      const key = `${entry.id}:${instanceId}`;
      if (sent.current.has(key)) return;
      sent.current.add(key);
      send({ id: entry.id, patch: { obtained: instanceId } }).then(
        (saved) => {
          if (saved.obtained?.instanceId === instanceId) onSaved();
        },
        () => sent.current.delete(key),
      );
    },
    [send],
  );
}

/** Takes a new drop off the list once its copy is gone, if it was never kept with Done. */
function DismantledWatch({ dropped }: { dropped: FarmEntry[] }) {
  const profile = useProfile().query.data;
  const remove = useFarmListMutations().remove.mutateAsync;
  const sent = useRef(new Set<string>());
  useEffect(() => {
    if (!profile) return;
    for (const entry of dismantledDrops(profile, dropped)) {
      if (sent.current.has(entry.id)) continue;
      sent.current.add(entry.id);
      remove(entry.id).catch(() => sent.current.delete(entry.id));
    }
  }, [profile, dropped, remove]);
  return null;
}

function WeaponWatch({ entries }: { entries: WeaponFarmEntry[] }) {
  const profile = useProfile().query.data;
  const report = useReportDrop();
  useEffect(() => {
    if (!profile) return;
    for (const { entry, copy } of newlyObtained(profile, entries)) {
      report(entry, copy.instanceId, () =>
        toast.success(
          `Farm list: ${entry.weaponName} dropped`,
          `${entry.traits[0].name} and ${entry.traits[1].name}, ${placeLabel(profile, copy.place)}.`,
        ),
      );
    }
  }, [profile, entries, report]);
  return null;
}

function ArmorWatch({ entries }: { entries: ArmorFarmEntry[] }) {
  const query = useArmory();
  // Live gear only: last visit's copy can list a piece that's since been dismantled.
  const pieces = query.isPlaceholderData ? undefined : query.data?.pieces;
  const report = useReportDrop();
  useEffect(() => {
    if (!pieces) return;
    for (const { entry, piece } of newlyObtainedArmor(pieces, entries)) {
      report(entry, piece.instanceId, () =>
        toast.success(`Farm list: ${armorFarmTitle(entry)} dropped`, `${piece.name}, ${armorPlaceLabel(piece)}.`),
      );
    }
  }, [pieces, entries, report]);
  return null;
}
