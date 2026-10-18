"use client";

import Image from "next/image";
import { useState, type CSSProperties, type ReactNode } from "react";
import { DetailCard, DetailSection } from "@/components/weapons/weapon-detail-card";
import type { Roll } from "@/lib/weapons/pick-slots";
import type { PerkRef, WeaponSummary } from "@/lib/weapons/types";
import type { WeaponPopularityView } from "@/lib/weapons/use-perk-popularity";
import { traitColumns } from "@/lib/weapons/perk-popularity";
import { cn } from "@/lib/utils";

/** Below this many copies the shares swing on a handful of players. */
const SMALL_SAMPLE = 30;
/** Combos listed. */
const COMBOS_SHOWN = 5;
/** Perks listed per column before "Show all perks". */
const PERKS_SHOWN = 4;

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const percent = (share: number) => (share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`);

/** A column's name in the card: the game's left and right perk for the traits. */
function columnLabel(weapon: WeaponSummary, column: number) {
  const traits = traitColumns(weapon.columns);
  if (traits?.[0] === column) return "Left perk";
  if (traits?.[1] === column) return "Right perk";
  const kind = weapon.columns[column]?.kind ?? "";
  if (kind === "Intrinsic") return "Frame";
  if (kind === "Origin Trait") return "Origin trait";
  return kind;
}

/**
 * How often players run this weapon's perks in PvE, beside the perk grid: the
 * most run left + right combos, then each column's perks. Every row picks its
 * perks in the grid (a combo picks both), so the stats show that roll.
 */
export function WeaponPopularityCard({
  weapon,
  view,
  perks,
  picked,
  onPick,
  className,
}: {
  weapon: WeaponSummary;
  view: WeaponPopularityView;
  perks: readonly PerkRef[];
  picked: Roll;
  /** Picks the roll's perks; picking a row that's already picked un-picks it. */
  onPick: (roll: Roll) => void;
  className?: string;
}) {
  const [allPerks, setAllPerks] = useState(false);
  const sampled = view.generatedAt ? shortDate.format(new Date(view.generatedAt)) : undefined;
  const combos = view.combos.slice(0, COMBOS_SHOWN);
  const hidden = view.columns.some((c) => c.perks.length > PERKS_SHOWN);
  const isPicked = (roll: Roll) => Object.entries(roll).every(([key, perk]) => picked[Number(key)] === perk);
  return (
    <DetailCard className={className}>
      <DetailSection
        title="Popular combos"
        description={
          <>
            How often players run each roll on the {view.copies.toLocaleString("en-US")}{" "}
            {view.copies === 1 ? "copy" : "copies"} we&apos;ve seen used in PvE
            {sampled ? `, as of ${sampled}` : ""}.
            {view.copies < SMALL_SAMPLE && " A small sample, so treat these as rough."}
          </>
        }
      >
        {combos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No combos counted for this weapon yet.</p>
        ) : (
          <ul className="grid gap-1">
            {combos.map((combo) => {
              const roll = { [combo.leftColumn]: combo.left, [combo.rightColumn]: combo.right };
              const left = perks[combo.left];
              const right = perks[combo.right];
              return (
                <li key={`${combo.left},${combo.right}`}>
                  <ShareRow
                    share={combo.share}
                    selected={isPicked(roll)}
                    label={`${left?.name} and ${right?.name}`}
                    onClick={() => onPick(roll)}
                    icons={[left, right]}
                  >
                    <span className="min-w-0 truncate">
                      {left?.name} <span className="text-muted-foreground">+</span> {right?.name}
                    </span>
                  </ShareRow>
                </li>
              );
            })}
          </ul>
        )}
      </DetailSection>
      <DetailSection
        title="Popular perks"
        action={
          <button
            type="button"
            onClick={() => onPick(view.topRoll)}
            className="d2-hover-ring h-7 bg-foreground/10 px-2.5 text-xs font-normal outline-none focus-visible:d2-tile-selected"
          >
            Try most popular roll
          </button>
        }
      >
        <div className="grid gap-3">
          {view.columns.map(({ column, perks: shares }) => (
            <section key={column} aria-label={columnLabel(weapon, column)} className="grid gap-1">
              <p className="d2-label">{columnLabel(weapon, column)}</p>
              {(allPerks ? shares : shares.slice(0, PERKS_SHOWN)).map(({ perkIndex, share }) => {
                const perk = perks[perkIndex];
                const roll = { [column]: perkIndex };
                return (
                  <ShareRow
                    key={perkIndex}
                    share={share}
                    selected={isPicked(roll)}
                    label={perk?.name ?? ""}
                    onClick={() => onPick(roll)}
                    icons={[perk]}
                  >
                    <span className="min-w-0 truncate">{perk?.name}</span>
                  </ShareRow>
                );
              })}
            </section>
          ))}
          {hidden && (
            <button
              type="button"
              onClick={() => setAllPerks((all) => !all)}
              className="justify-self-start text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:d2-tile-selected"
            >
              {allPerks ? "Show fewer perks" : "Show all perks"}
            </button>
          )}
        </div>
      </DetailSection>
    </DetailCard>
  );
}

/**
 * One row of the card: icons, a name, the share at the right end, on a fill as
 * wide as the share. Picked rows take the grid's picked blue.
 */
function ShareRow({
  share,
  selected,
  label,
  onClick,
  icons,
  children,
}: {
  share: number;
  selected: boolean;
  label: string;
  onClick: () => void;
  icons: (PerkRef | undefined)[];
  children: ReactNode;
}) {
  const fill: CSSProperties = selected
    ? {}
    : {
        backgroundImage: `linear-gradient(to right, color-mix(in srgb, var(--foreground) 10%, transparent) ${share * 100}%, transparent ${share * 100}%)`,
      };
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${label}, ${percent(share)}`}
      onClick={onClick}
      style={fill}
      className={cn(
        "d2-hover-ring flex h-8 w-full items-center gap-2 pr-2 pl-1 text-left text-[13px] outline-none focus-visible:d2-tile-selected",
        selected ? "bg-[#305f8e] text-white" : "bg-foreground/4",
      )}
    >
      <span className="flex shrink-0 gap-0.5">
        {icons.map((perk, i) =>
          perk?.icon ? (
            <Image
              key={i}
              src={`https://www.bungie.net${perk.icon}`}
              alt=""
              width={24}
              height={24}
              className="size-6"
              unoptimized
            />
          ) : (
            <span key={i} className="size-6 bg-foreground/10" />
          ),
        )}
      </span>
      <span className="flex min-w-0 flex-1">{children}</span>
      <span className="shrink-0 tabular-nums">{percent(share)}</span>
    </button>
  );
}
