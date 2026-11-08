"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DestinyProfileResponse } from "bungie-api-ts/destiny2";
import { ArmorFarmPanel } from "@/components/farm-list/armor-farm-list";
import { FarmCard, FarmField, FarmPanel, farmDate } from "@/components/farm-list/farm-list-card";
import { ObtainedActions, RemoveButton } from "@/components/farm-list/farm-list-actions";
import { Button } from "@/components/ui/button";
import { useProfile } from "@/lib/armory/use-profile";
import { finderPerkColumns } from "@/lib/inventory/perk-finder";
import { weaponRoll } from "@/lib/inventory/weapon-details";
import { useManifest } from "@/lib/manifest/use-manifest";
import type { Manifest } from "@/lib/manifest/load";
import { copyHasPerk, ownedCopies, placeLabel, type OwnedCopy } from "@/lib/farm-list/match";
import type { ArmorFarmEntry, FarmColumn, FarmPerk, WeaponFarmEntry } from "@/lib/farm-list/types";
import { useFarmList, useFarmListMutations } from "@/lib/farm-list/use-farm-list";
import { cn } from "@/lib/utils";

/** The perks, in the game's order. */
const COLUMNS = ["barrel", "magazine", "left", "right", "origin", "masterwork"] as const;
type ColumnKey = (typeof COLUMNS)[number];

/** An extra's column; an entry saved without slots goes by the column's name. */
function extraSlot(perk: FarmPerk): FarmColumn {
  if (perk.slot) return perk.slot;
  if (perk.kind === "Masterwork") return "masterwork";
  if (perk.kind === "Origin Trait") return "origin";
  return perk.kind === "Magazine" ? "magazine" : "barrel";
}

/** What the entry asks for in a column, or undefined for any. */
function wanted(entry: WeaponFarmEntry, column: ColumnKey): FarmPerk | undefined {
  if (column === "left") return entry.traits[0];
  if (column === "right") return entry.traits[1];
  return entry.extras.find((perk) => extraSlot(perk) === column);
}

/**
 * The Farm list: what the player is hunting, armor (see ArmorFarmPanel) and weapon rolls,
 * side by side, each thing its own card. A weapon's card lists the perks asked for. Drops
 * that matched every pick come first, each perk the copy has in blue; the player keeps one
 * with Done, which leaves it on the list as a record, or sends it back with "Not this one". Opening the page counts every drop as seen; the ones that were new keep their
 * "New" tag until the player leaves.
 */
export function FarmListPage() {
  const query = useFarmList();
  const markSeen = useFarmListMutations().markSeen.mutate;
  const entries = query.data;
  // Drops stay tagged New for the visit. The page is kept alive when it's left (Activity),
  // so a visit ends with the Effect's cleanup, and Effects only run while it's showing.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const unseen = entries?.filter((e) => e.obtained && !e.obtained.seen).map((e) => e.id) ?? [];
  if (unseen.some((id) => !fresh.has(id))) setFresh(new Set([...fresh, ...unseen]));
  const hasUnseen = unseen.length > 0;
  useEffect(() => {
    if (hasUnseen) markSeen();
  }, [hasUnseen, markSeen]);
  useEffect(() => () => setFresh(new Set()), []);

  const profile = useProfile().query.data;
  const manifestStatus = useManifest();
  const manifest = manifestStatus.state === "ready" ? manifestStatus.manifest : undefined;
  const weapons = entries?.filter((e): e is WeaponFarmEntry => e.kind === "weapon") ?? [];
  const armor = entries?.filter((e): e is ArmorFarmEntry => e.kind === "armor") ?? [];
  const linkClass = "underline underline-offset-2 hover:text-foreground";

  return (
    <main className="flex w-full flex-col gap-4 p-6 max-md:p-4">
      <p className="text-sm text-muted-foreground">
        Add weapon rolls from{" "}
        <Link href="/weapons" className={linkClass}>
          Weapon search
        </Link>{" "}
        and set armor from Theoretical Builds or a Dream build in the{" "}
        <Link href="/" className={linkClass}>
          Stat optimizer
        </Link>
        . When a match drops, it shows up under Dropped.
      </p>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading your Farm list…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{query.error.message}</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <ArmorFarmPanel entries={armor} fresh={fresh} manifest={manifest} />
          <FarmPanel
            title="Weapons"
            entries={weapons}
            empty="No weapons yet."
            renderCard={(entry) => (
              <WeaponCard
                key={entry.id}
                entry={entry}
                isNew={fresh.has(entry.id)}
                profile={profile}
                manifest={manifest}
              />
            )}
          />
        </div>
      )}
    </main>
  );
}

/** The copy a drop matched, as the profile has it now: where it is and what it rolled. */
interface Drop {
  copy: OwnedCopy;
  /** What the copy rolled in each column, once the manifest is ready to name it. */
  rolled?: Record<ColumnKey, string | undefined>;
}

/** The drop for an obtained entry; null once the copy is gone, undefined without one. */
function dropFor(
  entry: WeaponFarmEntry,
  profile: DestinyProfileResponse | undefined,
  manifest: Manifest | undefined,
): Drop | null | undefined {
  if (!entry.obtained || !profile) return undefined;
  const copy = ownedCopies(profile).find((c) => c.instanceId === entry.obtained!.instanceId);
  if (!copy) return null;
  if (!manifest) return { copy };
  const roll = weaponRoll(profile, manifest, copy.instanceId);
  const [barrel, magazine, left, right, , origin] = finderPerkColumns(roll);
  const names = (column: typeof barrel) => column?.options.map((o) => o.name).join(", ");
  const stat = roll.mods.find((m) => m.kind === "masterwork")?.stat;
  return {
    copy,
    rolled: {
      barrel: names(barrel),
      magazine: names(magazine),
      left: names(left),
      right: names(right),
      origin: names(origin),
      masterwork: stat?.name ?? "None",
    },
  };
}

/** Whether the copy has what the entry asks for in a column; undefined until it can tell. */
function matches(profile: DestinyProfileResponse, drop: Drop, column: ColumnKey, perk: FarmPerk) {
  // A masterwork goes by its stat, which takes the manifest to read.
  if (column === "masterwork") return drop.rolled ? `${drop.rolled.masterwork} Masterwork` === perk.name : undefined;
  return copyHasPerk(profile, drop.copy.instanceId, perk);
}

function WeaponCard({
  entry,
  isNew,
  profile,
  manifest,
}: {
  entry: WeaponFarmEntry;
  isNew: boolean;
  profile: DestinyProfileResponse | undefined;
  manifest: Manifest | undefined;
}) {
  const drop = dropFor(entry, profile, manifest);
  const status = entry.obtained
    ? `Dropped ${farmDate.format(entry.obtained.at)}${
        drop ? `, ${placeLabel(profile, drop.copy.place)}` : drop === null ? ", since removed" : ""
      }`
    : `Added ${farmDate.format(entry.createdAt)}`;
  return (
    <FarmCard
      id={entry.id}
      thumb={
        entry.weaponIcon ? (
          <Image
            src={`https://www.bungie.net${entry.weaponIcon}`}
            alt=""
            width={48}
            height={48}
            unoptimized
            className="size-12 shrink-0 outline-1 -outline-offset-1 outline-foreground/24"
          />
        ) : (
          <span className="size-12 shrink-0 bg-foreground/8" />
        )
      }
      title={<span className="truncate font-medium">{entry.weaponName}</span>}
      isNew={isNew}
      status={status}
      actions={entry.obtained ? <ObtainedActions entry={entry} /> : <WaitingActions entry={entry} />}
    >
      {COLUMNS.map((key) => {
        const perk = wanted(entry, key);
        // A dismantled copy can't be read, but it only counted because it had every required
        // pick. Whether it had the masterwork can't be known any more.
        const match =
          drop && profile && perk
            ? matches(profile, drop, key, perk)
            : drop === null && perk && key !== "masterwork"
              ? true
              : undefined;
        const rolled = drop?.rolled?.[key];
        // A field for each thing asked for, and for what a drop rolled where any would do.
        const rolledAny = !perk && rolled && rolled !== "None" ? rolled : undefined;
        if (!perk && !rolledAny) return null;
        return (
          <FarmField key={key} column={key}>
            {perk && <PerkCell perk={perk} match={match} />}
            {(rolledAny ?? (match === false ? rolled : undefined)) && (
              <span className="truncate text-xs text-muted-foreground" title={rolled}>
                {rolled}
              </span>
            )}
          </FarmField>
        );
      })}
    </FarmCard>
  );
}

/** A wanted perk: its icon and name, marked on the icon's corner once a drop can be compared. */
function PerkCell({ perk, match }: { perk: FarmPerk; match: boolean | undefined }) {
  const square = perk.kind === "Masterwork";
  const compared = match !== undefined ? { role: "img", "aria-label": match ? "Matches" : "Doesn't match" } : {};
  return (
    <span className={cn("flex min-w-0 items-center gap-2", match === false && "text-muted-foreground")}>
      {perk.icon ? (
        <span className="relative shrink-0">
          {/* What the copy has reads like a picked perk in Weapon search, filled blue; what it's missing gets a red ring and a light red fill. */}
          <span
            {...compared}
            className={cn(
              "flex size-7 items-center justify-center overflow-hidden",
              !square && "rounded-full border border-foreground/12",
              !square && match === undefined && "bg-foreground/4",
              match && "bg-[#305f8e]",
              match === false && "border border-destructive bg-destructive/20",
              square && match !== undefined && "p-0.5 [&>img]:size-full",
            )}
          >
            <Image
              src={`https://www.bungie.net${perk.icon}`}
              alt=""
              width={square ? 28 : 22}
              height={square ? 28 : 22}
              unoptimized
            />
          </span>
        </span>
      ) : null}
      <span className="min-w-0 leading-tight" title={perk.name}>
        {perk.name}
      </span>
    </span>
  );
}

function WaitingActions({ entry }: { entry: WeaponFarmEntry }) {
  return (
    <>
      <Button
        variant="outline"
        render={<Link href={`/weapons?q=${encodeURIComponent(entry.weaponName)}`} />}
        nativeButton={false}
      >
        Open
      </Button>
      <RemoveButton entry={entry} label="Remove" />
    </>
  );
}
