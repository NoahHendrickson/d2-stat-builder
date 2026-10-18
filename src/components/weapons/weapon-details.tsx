"use client";

import Image from "next/image";
import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PopularityBar,
  PopularityShare,
  PopularityToggle,
} from "@/components/weapons/perk-popularity-controls";
import { PerkTooltip } from "@/components/weapons/perk-tooltip";
import {
  CollapsibleDetailSection,
  DetailCard,
  DetailSection,
  FrameRow,
} from "@/components/weapons/weapon-detail-card";
import { DpsSetups } from "@/components/weapons/weapon-dps-setups";
import {
  AMMO_TYPE,
  AmmoIcon,
  ChampionIcon,
  ElementIcon,
  TypeSilhouette,
  WeaponIcon,
} from "@/components/weapons/weapon-icons";
import { WeaponStats } from "@/components/weapons/weapon-stats";
import type { WeaponCatalog } from "@/lib/weapons/catalog";
import { clarityLines } from "@/lib/weapons/clarity";
import { weaponDisplayStats } from "@/lib/weapons/display-stats";
import { pickSlots, resolveFrame, type PickSlot, type Roll } from "@/lib/weapons/pick-slots";
import type { WeaponSummary } from "@/lib/weapons/types";
import { useClarity } from "@/lib/weapons/use-clarity";
import { useWeaponPopularity } from "@/lib/weapons/use-perk-popularity";
import { useWeaponDps } from "@/lib/weapons/use-weapon-dps";
import {
  DPS_SHEET_URL,
  compatibleSetups,
  setupRolls,
  weaponDpsKey,
  weaponPerkNames,
} from "@/lib/weapons/weapon-dps";
import { weaponTypeIcon } from "@/lib/weapons/weapon-type-icon-paths";
import { cn } from "@/lib/utils";

type RevealRow = {
  /** The chip whose name is open, by label, and that name's full width. */
  open: { label: string; width: number } | null;
  /** Room held before the chip under the pointer, so it stays put as the rest settle. */
  hold: { label: string; px: number } | null;
  register: (label: string, chip: HTMLElement) => () => void;
  enter: (label: string, width: number, chip: HTMLElement, pointerX: number) => void;
  leave: () => void;
};

const RevealRowContext = createContext<RevealRow | null>(null);

/**
 * The details header's chips, opened one at a time. A name stays open until
 * the pointer reaches another chip or leaves the row, so crossing the gap
 * between two chips doesn't close it under the pointer. Entering a chip sends
 * every other chip back to its place and closes their names. If that would
 * carry the entered chip out from under the pointer, it holds room before it
 * for exactly what goes away to its left, easing in step, so it stays put;
 * otherwise it slides along with the rest. Leaving the row lets the room go.
 */
function useRevealRow(): RevealRow {
  const [open, setOpen] = useState<RevealRow["open"]>(null);
  const [hold, setHold] = useState<RevealRow["hold"]>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const current = useRef<string | null>(null);
  return {
    open,
    hold,
    register(label, chip) {
      chips.current.set(label, chip);
      return () => {
        if (chips.current.get(label) === chip) chips.current.delete(label);
      };
    },
    enter(label, width, chip, pointerX) {
      if (current.current === label) return;
      current.current = label;
      // What sits to its left right now, even part way through easing: held
      // room (a margin) and open names.
      let px = 0;
      for (const other of chips.current.values()) {
        const before =
          other === chip ||
          Boolean(other.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (!before) continue;
        px += parseFloat(getComputedStyle(other).marginLeft) || 0;
        const name = other.lastElementChild;
        if (other !== chip && name) px += name.getBoundingClientRect().width;
      }
      // Where its right edge lands with nothing held: its frame, closed, plus
      // the full name. Short of the pointer (with some slack), it must hold.
      const box = chip.getBoundingClientRect();
      const name = chip.lastElementChild?.getBoundingClientRect().width ?? 0;
      const right = box.left - px + box.width - name + width;
      setOpen({ label, width });
      setHold(px > 0.5 && pointerX > right - 8 ? { label, px } : null);
    },
    leave() {
      current.current = null;
      setOpen(null);
      setHold(null);
    },
  };
}

/**
 * One of the details header's icons, whose name slides open beside it in a
 * frame on hover, like the build card's icon actions. Names and held room ease
 * over the same time, in px, so a chip held in place stays exactly there.
 */
function RevealChip({ label, children }: { label: string; children: ReactNode }) {
  const row = useContext(RevealRowContext);
  const text = useRef<HTMLSpanElement>(null);
  const open = row?.open?.label === label ? row.open : null;
  return (
    <span
      ref={(chip) => (row && chip ? row.register(label, chip) : undefined)}
      data-open={open ? true : undefined}
      onPointerEnter={(event) => {
        if (text.current) {
          row?.enter(
            label,
            text.current.offsetWidth,
            event.currentTarget,
            event.clientX,
          );
        }
      }}
      className="inline-flex shrink-0 items-center border border-transparent px-1.5 py-1 transition-[background-color,border-color,color,margin-left] duration-200 ease-out motion-reduce:transition-none data-open:border-foreground/24 data-open:bg-foreground/4 data-open:text-foreground normal:rounded-md"
      style={{ marginLeft: row?.hold?.label === label ? row.hold.px : 0 }}
    >
      {children}
      {/* The name; last in the chip, where the row reads its width. */}
      <span
        className="overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: open?.width ?? 0 }}
      >
        <span ref={text} className="block w-max pl-2 text-sm whitespace-nowrap">
          {label}
        </span>
      </span>
    </span>
  );
}

/**
 * A perk under the pointer: the slot it picks in (its key), and its catalog
 * index, or null for a slot's empty socket (previewing the slot cleared).
 */
type PerkHover = { slot: number; perk: number | null };

/**
 * Bungie's "Empty Mod Socket" plug (2323986101, `v400.weapon.mod_empty`): the
 * art the game shows in a weapon's unfilled mod socket. Weapons have no empty
 * masterwork (every one starts at Tier 1), so the Masterworks section uses it
 * too.
 */
const EMPTY_SOCKET_ICON = "/common/destiny2_content/icons/431cc8304da4f5eb44c5c10a5c1866ce.jpg";

/** Picks without one slot's. */
function withoutSlot(picks: Roll, slot: number): Roll {
  const { [slot]: _removed, ...rest } = picks;
  void _removed;
  return rest;
}

/**
 * One weapon's page: the header (the list row, opened up), then the Stats card
 * (stats, then the boss DPS the sheet has for it) and the Perks card (the
 * perk grid, then the masterworks and mods). Picking perks moves the stats, and
 * hovering one previews it.
 *
 * Memoized: the list beside it re-renders this page as it scrolls (the virtualizer
 * lives in the same parent), and the details would otherwise recompute their stats and
 * rebuild every perk tile each time for a weapon that hasn't changed.
 */
export const WeaponDetails = memo(function WeaponDetails({
  weapon,
  catalog,
  inDialog = false,
}: {
  weapon: WeaponSummary;
  catalog: WeaponCatalog;
  inDialog?: boolean;
}) {
  const clarity = useClarity().data;
  // How often players run each perk, from the popularity crawl.
  const popularity = useWeaponPopularity(weapon, catalog);
  const slots = useMemo(() => pickSlots(weapon), [weapon]);
  const perkSlots = slots.filter((slot) => slot.kind === "perk");
  const extraSlots = slots.filter((slot) => slot.kind !== "perk");

  // Boss DPS for this copy: the sheet's setups for its name, less any run on
  // another version of it (see compatibleSetups), each with the roll it names.
  // Only changes with the weapon, not with every hover.
  const dpsIndex = useWeaponDps().data;
  const { dpsSetups, dpsRolls } = useMemo(() => {
    const key = weaponDpsKey(weapon.name);
    const all = dpsIndex?.weapons[key] ?? [];
    if (all.length === 0) return { dpsSetups: [], dpsRolls: [] };
    const versions = new Set<string>();
    for (const other of catalog.weapons)
      if (weaponDpsKey(other.name) === key)
        for (const name of weaponPerkNames(other, catalog.perks)) versions.add(name);
    const setups = compatibleSetups(all, weaponPerkNames(weapon, catalog.perks), versions);
    return { dpsSetups: setups, dpsRolls: setupRolls(setups, slots, catalog.perks) };
  }, [dpsIndex, weapon, catalog, slots]);

  // One pick per slot; a hovered perk previews in place of its slot's pick.
  // Keyed by weapon, so both reset.
  const [picked, setPicked] = useState<Roll>({});
  const [hovered, setHovered] = useState<PerkHover | null>(null);
  const statsFor = (picks: Roll) =>
    weaponDisplayStats(
      weapon,
      catalog.statCurves,
      Object.values(picks).flatMap((i) => catalog.perks[i] ?? []),
    );
  // Picks are the settled roll, drawn plain; a hover shows its change against
  // them in green and red.
  const current = statsFor(picked);
  const preview = !hovered
    ? current
    : statsFor(
        hovered.perk === null
          ? withoutSlot(picked, hovered.slot)
          : { ...picked, [hovered.slot]: hovered.perk },
      );
  function toggle(slot: number, perk: number) {
    setPicked(({ [slot]: current, ...rest }) => (current === perk ? rest : { ...rest, [slot]: perk }));
  }
  // A setup's roll replaces whatever is picked in the slots any setup uses,
  // so going from one setup to another leaves none of the first behind; the
  // user's picks elsewhere stay.
  function pickDpsRoll(roll: Roll) {
    const used = new Set(dpsRolls.flatMap((r) => Object.keys(r ?? {})));
    setPicked((picks) => ({
      ...Object.fromEntries(Object.entries(picks).filter(([key]) => !used.has(key))),
      ...roll,
    }));
  }
  // The frame for the header and the Stats card alike: the one picked, else
  // the weapon's own (see resolveFrame).
  const frame = resolveFrame(weapon, catalog.perks, picked);
  const frameName = frame.perk?.name ?? weapon.frame ?? "Frame";

  /**
   * A masterwork or mod slot's empty socket, first in its section, drawn with
   * the game's empty-socket art: picking it clears the slot, hovering it
   * previews the stats without that slot's pick. It dims like the others once
   * something else in the slot is picked.
   */
  function emptyTile(slot: PickSlot) {
    const empty = picked[slot.key] === undefined;
    const label = slot.kind === "mod" ? "No mod" : "No masterwork";
    return (
      <Tooltip key="empty">
        <TooltipTrigger
          delay={0}
          render={
            <button
              type="button"
              aria-label={label}
              aria-pressed={empty}
              onClick={() => setPicked((picks) => withoutSlot(picks, slot.key))}
              onPointerEnter={() => setHovered({ slot: slot.key, perk: null })}
              onPointerLeave={() =>
                setHovered((h) => (h?.slot === slot.key && h.perk === null ? null : h))
              }
              className={cn(
                "relative flex size-14 shrink-0 items-center justify-center outline-none transition-[opacity,filter] hover:brightness-125 focus-visible:[&>img]:d2-tile-selected max-md:size-11",
                !empty && "opacity-40 hover:opacity-100",
              )}
            />
          }
        >
          <Image src={`https://www.bungie.net${EMPTY_SOCKET_ICON}`} alt="" width={44} height={44} unoptimized />
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          {slot.kind === "mod" ? "Empty mod socket" : "No masterwork"}
        </TooltipContent>
      </Tooltip>
    );
  }

  /** One perk's tile in its slot. */
  function perkTile(slot: PickSlot, index: number) {
    const perk = catalog.perks[index];
    if (!perk) return null;
    const selected = picked[slot.key] === index;
    const craftedOnly = slot.craftedOnly?.includes(index) ?? false;
    const label = !perk.currentlyCanRoll
      ? `${perk.name} (retired)`
      : craftedOnly
        ? `${perk.name} (crafted only)`
        : perk.name;
    // Drawn like the Items popover's perk grid (PerkColumnView), at the full size of
    // its Figma cell: a round cell with a hairline, filled blue once picked, and
    // the enhanced arrow in the top-left for perks with an enhanced tier. The
    // name lives in the tooltip. Masterwork and mod art is its own framed
    // square, so it goes without a cell; once one is picked, the others dim.
    const bare = slot.kind !== "perk";
    const iconSize = bare ? 44 : 34;
    const content = (
      <>
        {perk.icon && (
          <Image
            src={`https://www.bungie.net${perk.icon}`}
            alt=""
            width={iconSize}
            height={iconSize}
            unoptimized
          />
        )}
        {perk.alternateHashes?.length ? (
          <Image
            src="/manager/perk-enhanced.svg"
            alt=""
            width={10}
            height={10}
            className="absolute top-1 left-1"
          />
        ) : null}
      </>
    );
    const trigger = (
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onClick={() => toggle(slot.key, index)}
        onPointerEnter={() => setHovered({ slot: slot.key, perk: index })}
        // Leaving a tile ends its preview, even into the gaps between
        // tiles; only clear if a neighbour hasn't already taken over.
        onPointerLeave={() =>
          setHovered((h) => (h?.slot === slot.key && h.perk === index ? null : h))
        }
        className={cn(
          "relative flex size-14 shrink-0 items-center justify-center outline-none max-md:size-11",
          bare
            ? cn(
                "transition-[opacity,filter] hover:brightness-125 focus-visible:[&>img]:d2-tile-selected",
                picked[slot.key] !== undefined && !selected && "opacity-40 hover:opacity-100",
              )
            : cn(
                "rounded-full border border-foreground/12 transition-colors focus-visible:d2-tile-selected",
                selected ? "bg-[#305f8e]" : "bg-foreground/4 hover:bg-foreground/10",
              ),
          !perk.currentlyCanRoll && "opacity-40",
        )}
      />
    );
    const tile = (
      <Tooltip key={index}>
        <TooltipTrigger delay={0} render={trigger}>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" align="start" className="max-w-sm">
          <PerkTooltip perk={perk} insight={clarityLines(clarity, perk)} craftedOnly={craftedOnly} />
        </TooltipContent>
      </Tooltip>
    );
    // A perk column's tile carries its popularity under it while that shows.
    return slot.kind === "perk" ? (
      <PopularityShare key={index} view={popularity} column={slot.key} perkIndex={index} selected={selected}>
        {tile}
      </PopularityShare>
    ) : (
      tile
    );
  }

  const poolLabel = catalog.poolLabel(weapon.hash);
  // Where it drops from, each part named so the bare values read.
  const origin = (
    [
      ["Source", poolLabel !== weapon.source ? weapon.source : undefined],
      ["Season", weapon.seasonName],
    ] satisfies [string, string | undefined][]
  ).filter((part): part is [string, string] => Boolean(part[1]));
  const reveal = useRevealRow();
  const Title = inDialog ? DialogTitle : "h2";
  const Description = inDialog ? DialogDescription : "div";
  return (
    <>
      {/* The list row, opened up: the same outlined icon, the name, then the
          row's icons in the same order with where it drops from after them. */}
      <div className={cn("flex items-center gap-4", inDialog && "pr-8")}>
        <WeaponIcon
          weapon={weapon}
          size={inDialog ? 56 : 72}
          className="outline-1 -outline-offset-1 outline-foreground/24"
        />
        <div className="grid min-w-0 grid-cols-1 gap-2">
          <Title
            className={cn(
              "font-medium",
              inDialog ? "text-base" : "text-xl",
              weapon.rarity === "Exotic" && "text-amber-300",
            )}
          >
            {weapon.name}
            {poolLabel && <span className="ml-2 font-normal text-muted-foreground">{poolLabel}</span>}
          </Title>
          {/* Pulled left by a chip's padding and border, so the first icon
              lines up under the name. */}
          <Description
            className="-ml-[7px] flex items-center gap-1.5 text-muted-foreground max-md:flex-wrap"
            onPointerLeave={reveal.leave}
          >
            <RevealRowContext value={reveal}>
              {weaponTypeIcon(weapon.type, AMMO_TYPE[weapon.ammo]) && (
                <RevealChip label={weapon.type}>
                  <TypeSilhouette weapon={weapon} tight />
                </RevealChip>
              )}
              <RevealChip label={weapon.element}>
                <ElementIcon element={weapon.element} damageTypes={catalog.damageTypes} size={18} />
              </RevealChip>
              {frame.perk?.icon && (
                <Tooltip>
                  <TooltipTrigger
                    // Its full description and Clarity insight, which no perk
                    // tile carries once a fixed frame leaves the grid.
                    render={<span className="inline-flex shrink-0" />}
                  >
                    <RevealChip label={frameName}>
                      <Image
                        className="shrink-0"
                        src={`https://www.bungie.net${frame.perk.icon}`}
                        alt={frameName}
                        width={20}
                        height={20}
                        unoptimized
                      />
                    </RevealChip>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-sm">
                    <PerkTooltip perk={frame.perk} insight={clarityLines(clarity, frame.perk)} />
                  </TooltipContent>
                </Tooltip>
              )}
              <RevealChip label={`${weapon.ammo} ammo`}>
                <AmmoIcon ammo={weapon.ammo} ammoTypes={catalog.ammoTypes} tight />
              </RevealChip>
              {weapon.champions?.map((champion) => (
                <RevealChip key={champion} label={`Anti-${champion}`}>
                  <ChampionIcon champion={champion} championTypes={catalog.championTypes} />
                </RevealChip>
              ))}
              {/* Last on the line and the one part that gives way, so the
                  header stays two lines in a narrow pane. */}
              {origin.length > 0 && (
                <span
                  className="ml-2 min-w-0 truncate max-md:ml-[7px] max-md:basis-full max-md:whitespace-normal"
                  title={origin.map(([name, value]) => `${name}: ${value}`).join(", ")}
                >
                  {origin.map(([name, value]) => (
                    <span key={name} className="mr-4 last:mr-0">
                      {name}: {value}
                    </span>
                  ))}
                </span>
              )}
            </RevealRowContext>
          </Description>
        </div>
      </div>
      <div aria-hidden className="d2-rule" />
      {/* Two cards. From md up the stats card sits on the left, with the
          advanced stats under the stats, and the perks card on the right, with
          the masterworks and mods under the perks; the stats card takes what
          width is left, going above once that is under 16rem. Phones keep the
          perks first. */}
      <div className="flex flex-wrap items-start gap-4">
        {slots.length > 0 && (
          <DetailCard className="min-w-0 max-w-full">
            {perkSlots.length > 0 && (
              <DetailSection
                title="Perks"
                action={popularity.available && <PopularityToggle view={popularity} />}
                description={
                  popularity.available &&
                  popularity.shown && (
                    <PopularityBar
                      view={popularity}
                      onTryTop={(roll) => setPicked((picks) => ({ ...picks, ...roll }))}
                    />
                  )
                }
              >
                <div className="flex max-w-full gap-2.5 overflow-x-auto pb-1 max-md:gap-1.5">
                  {perkSlots.map((slot) => (
                    <section
                      key={slot.key}
                      aria-label={slot.label}
                      className="flex shrink-0 flex-col gap-2.5 max-md:gap-1.5"
                    >
                      {slot.perkIndices.map((index) => perkTile(slot, index))}
                    </section>
                  ))}
                </div>
              </DetailSection>
            )}
            {/* Masterworks, then the mod socket's choices that move a stat. */}
            {extraSlots.map((slot) => (
              <DetailSection key={slot.key} title={slot.label}>
                {/* Wraps to the perks' width (w-0 min-w-full) rather than
                    widening the card. */}
                <div
                  className={cn(
                    "flex flex-wrap gap-2.5 max-md:gap-1.5",
                    perkSlots.length > 0 && "w-0 min-w-full",
                  )}
                >
                  {emptyTile(slot)}
                  {slot.perkIndices.map((index) => perkTile(slot, index))}
                </div>
              </DetailSection>
            ))}
          </DetailCard>
        )}
        {/* Touch has no hover: phones open a perk's tooltip on a held finger. */}
        <p className="-mt-2 basis-full text-xs text-muted-foreground md:hidden">
          Tap a perk to pick it, or press and hold to read it.
        </p>
        {(Object.keys(current).length > 0 || dpsSetups.length > 0) && (
          <DetailCard className="min-w-64 flex-1 basis-64 md:order-first md:max-w-sm">
            {Object.keys(current).length > 0 && (
              <DetailSection title="Stats">
                {frame.perk && <FrameRow perk={frame.perk} insight={clarityLines(clarity, frame.perk)} />}
                <WeaponStats base={current} stats={preview} />
              </DetailSection>
            )}
            {dpsSetups.length > 0 && (
              <CollapsibleDetailSection
                title="Advanced stats"
                description={
                  <>
                    Simulated boss damage from{" "}
                    <a
                      href={DPS_SHEET_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Aegis&apos;s boss DPS sheet
                    </a>
                    . Open it for the full assumptions behind each setup.
                  </>
                }
              >
                <DpsSetups
                  setups={dpsSetups}
                  rolls={dpsRolls}
                  perks={catalog.perks}
                  onSeePerks={pickDpsRoll}
                />
              </CollapsibleDetailSection>
            )}
          </DetailCard>
        )}
      </div>
    </>
  );
});
