"use client";

import type { CSSProperties, ReactNode } from "react";
import { subclassFromPlugCategory } from "@/lib/armory/fragments";
import { isFullyMasterworked } from "@/lib/armory/masterwork";
import { armorPipTier } from "@/lib/armory/normalize";
import { SLOT_LABELS, STAT_LABELS, STAT_ORDER, type StatIconMap } from "@/lib/armory/stats";
import { ABILITY_KINDS, ABILITY_LABELS } from "@/lib/dim/subclasses";
import type { Manifest } from "@/lib/manifest/load";
import type { ResolvedArmorItem, ResolvedLoadout, ResolvedSubclass } from "@/lib/loadouts/resolve";
import { superSocketIndex } from "@/lib/loadouts/subclass";
import type { SavedLoadout } from "@/lib/loadouts/types";
import { ArmorThumb } from "@/components/armor-thumb";
import { PowerValue } from "@/components/power-value";
import { StatGlyph } from "@/components/stat-glyph";
import { ManifestIcon, PlugIcon } from "@/components/loadouts/loadout-row-details";
import { cn } from "@/lib/utils";

/** An unfilled mod socket: the game's empty-slot bracket corners. */
function EmptySocket() {
  return <span className="d2-brackets size-6 shrink-0 bg-black/20" aria-hidden />;
}

function ColumnGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="d2-label text-[10px]">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Super as the column's badge, then abilities, aspects, and fragments. */
function SubclassColumn({
  subclass,
  manifest,
  classType,
}: {
  subclass: ResolvedSubclass | undefined;
  manifest: Manifest;
  classType: number;
}) {
  if (!subclass) {
    return (
      <section aria-label="Subclass" className="flex flex-col gap-1">
        <span className="d2-label text-[10px]">Subclass</span>
        <p className="text-muted-foreground text-xs">No subclass saved</p>
      </section>
    );
  }
  const subclassDef = manifest.def("DestinyInventoryItemDefinition", subclass.itemHash);
  const subclassName =
    subclassDef?.displayProperties?.name ?? subclass.subclass ?? "Subclass";
  const superStart = superSocketIndex(manifest, subclass.itemHash);
  const initialSuperHash =
    superStart !== undefined
      ? subclassDef?.sockets?.socketEntries[superStart]?.singleInitialItemHash
      : undefined;
  const superDef = manifest.def(
    "DestinyInventoryItemDefinition",
    subclass.superHash ?? (initialSuperHash || undefined),
  );
  const superName = superDef?.displayProperties?.name;
  // Pinned abilities besides the Super, in socket order (class ability, jump, melee, grenade).
  const abilities = ABILITY_KINDS.filter((kind) => kind !== "super").flatMap((kind) => {
    const hash = subclass.abilityHashes[kind];
    return hash === undefined ? [] : [{ kind, hash }];
  });

  return (
    <section aria-label={`Subclass: ${subclassName}`} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <ManifestIcon
          icon={superDef?.displayProperties?.icon ?? subclassDef?.displayProperties?.icon}
          label={superName ? `${superName} · ${subclassName}` : subclassName}
          size={40}
          className="rounded-none"
          element={
            subclassFromPlugCategory(superDef?.plug?.plugCategoryIdentifier) ??
            subclass.subclass
          }
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{subclassName}</span>
          <span className="text-muted-foreground truncate text-xs">
            {superName ?? "Subclass"}
          </span>
        </div>
      </div>
      {abilities.length > 0 && (
        <ColumnGroup label="Abilities">
          {abilities.map(({ kind, hash }) => (
            <PlugIcon
              key={kind}
              hash={hash}
              manifest={manifest}
              suffix={ABILITY_LABELS[kind]}
              size={32}
              className="rounded-none"
              element={subclass.subclass}
            />
          ))}
        </ColumnGroup>
      )}
      {subclass.aspectHashes.length > 0 && (
        <ColumnGroup label="Aspects">
          {subclass.aspectHashes.map((hash) => (
            <PlugIcon
              key={hash}
              hash={hash}
              manifest={manifest}
              size={32}
              className="rounded-none"
              element={subclass.subclass}
            />
          ))}
        </ColumnGroup>
      )}
      {subclass.fragmentHashes.length > 0 && (
        <ColumnGroup label="Fragments">
          {subclass.fragmentHashes.map((hash, i) => (
            <PlugIcon
              key={`${hash}-${i}`}
              hash={hash}
              manifest={manifest}
              size={32}
              className="rounded-none"
              classType={classType}
              element={subclass.subclass}
            />
          ))}
        </ColumnGroup>
      )}
    </section>
  );
}

/**
 * One armor piece: art, name, power, then its mod sockets in socket order (the saved
 * placement where there is one, an empty bracket where there isn't), then the
 * optimizer's tuning / artifice pick for the slot.
 */
function PieceColumn({
  item,
  placement,
  tuning,
  manifest,
}: {
  item: ResolvedArmorItem;
  placement: Record<number, number> | undefined;
  /** The slot's tuning / artifice line (see TuningLine). */
  tuning: ReactNode;
  manifest: Manifest;
}) {
  const { piece } = item;
  // Socket order from the live piece; without it (missing piece) the placement's own order.
  const sockets: { index: number; hash?: number }[] = piece?.armorSockets
    ? piece.armorSockets.map((s) => ({ index: s.index, hash: placement?.[s.index] }))
    : Object.entries(placement ?? {})
        .map(([index, hash]) => ({ index: Number(index), hash }))
        .sort((a, b) => a.index - b.index);
  const slotLabel = item.slot ? SLOT_LABELS[item.slot] : "Armor";

  return (
    <section
      aria-label={`${item.name}, ${slotLabel}`}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 flex-col gap-2 @3xl:flex-row @3xl:items-center">
        {item.icon ? (
          <ArmorThumb
            icon={item.icon}
            watermark={piece?.watermark}
            alt={item.name}
            size={56}
            masterworked={isFullyMasterworked(piece)}
            gearTier={armorPipTier(piece)}
            className={cn("size-12 @3xl:size-14", item.missing && "opacity-50")}
          />
        ) : (
          <span className="d2-brackets size-12 shrink-0 bg-black/25 @3xl:size-14" aria-hidden />
        )}
        <div className="hidden min-w-0 flex-col @3xl:flex">
          <span
            className={cn(
              "truncate text-sm leading-5",
              piece?.isExotic && "text-exotic",
              item.missing && "text-muted-foreground",
            )}
            title={item.name}
          >
            {item.name}
          </span>
          <span className="flex items-center gap-2 text-xs">
            {item.missing ? (
              <span className="text-warning">Missing</span>
            ) : (
              <span className="text-muted-foreground">{slotLabel}</span>
            )}
            {piece?.power !== undefined && (
              <PowerValue
                value={piece.power}
                size="xs"
                tone="gold"
                className="shrink-0 items-center gap-0.5 text-xs"
                title="Power"
              />
            )}
          </span>
        </div>
      </div>
      {sockets.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Mods">
          {sockets.map(({ index, hash }) =>
            hash === undefined ? (
              <EmptySocket key={index} />
            ) : (
              <PlugIcon key={index} hash={hash} manifest={manifest} className="rounded-none" />
            ),
          )}
        </div>
      )}
      {tuning}
    </section>
  );
}

/** The optimizer's tuning or artifice pick for one armor slot, as a glyph and a short label. */
function TuningLine({
  saved,
  pieceId,
  statIcons,
  balancedTuningIcon,
}: {
  saved: SavedLoadout;
  pieceId: string | undefined;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
}) {
  const { optimizer } = saved;
  const slotIndex = optimizer && pieceId ? optimizer.pieceIds.indexOf(pieceId) : -1;
  if (!optimizer || slotIndex < 0) return null;
  const tune = optimizer.tuning[slotIndex];
  const artifice = optimizer.artifice[slotIndex];
  let glyph: ReactNode;
  let text: string;
  if (tune?.kind === "balanced") {
    glyph = <StatGlyph src={balancedTuningIcon} label="Balanced Tuning" invert={false} />;
    text = "Balanced";
  } else if (tune?.kind === "directional") {
    const stat = STAT_ORDER[tune.plus];
    glyph = <StatGlyph src={statIcons[stat]} label={`Tuned +5 ${STAT_LABELS[stat]}`} />;
    text = "+5 tuned";
  } else if (artifice !== null && artifice !== undefined) {
    const stat = STAT_ORDER[artifice];
    glyph = <StatGlyph src={statIcons[stat]} label={`Artifice +3 ${STAT_LABELS[stat]}`} />;
    text = "+3 artifice";
  } else {
    return null;
  }
  return (
    <span className="text-muted-foreground flex items-center gap-1 text-[11px] leading-4">
      {glyph}
      <span className="hidden @3xl:inline">{text}</span>
    </span>
  );
}

/**
 * The card's body, laid out like the editor drawer: the subclass column on the far left,
 * then one column per armor piece with its mods. Below the card's `@3xl` width the
 * subclass sits on top and the pieces shrink to icon columns.
 */
export function LoadoutCardBody({
  saved,
  resolved,
  manifest,
  statIcons,
  balancedTuningIcon,
}: {
  saved: SavedLoadout;
  resolved: ResolvedLoadout;
  manifest: Manifest;
  statIcons: StatIconMap;
  balancedTuningIcon?: string;
}) {
  const { loadout, modPlacement } = saved;
  const pieceCols = Math.max(resolved.armor.length, 1);
  return (
    <div className="flex flex-col gap-3">
      <div
        className="grid gap-x-4 gap-y-4 [grid-template-columns:repeat(var(--pieces),minmax(0,1fr))] @3xl:[grid-template-columns:minmax(14rem,1.25fr)_repeat(var(--pieces),minmax(0,1fr))] @3xl:divide-x @3xl:divide-foreground/8 @3xl:gap-x-0 @3xl:*:px-4 @3xl:*:first:pl-0 @3xl:*:last:pr-0"
        style={{ "--pieces": pieceCols } as CSSProperties}
      >
        <div className="col-span-full @3xl:col-span-1">
          <SubclassColumn
            subclass={resolved.subclass}
            manifest={manifest}
            classType={loadout.classType}
          />
        </div>
        {resolved.armor.map((item, i) => (
          <PieceColumn
            key={`${item.ref.id ?? item.ref.hash}-${i}`}
            item={item}
            placement={item.ref.id ? modPlacement?.[item.ref.id] : undefined}
            tuning={
              <TuningLine
                saved={saved}
                pieceId={item.ref.id}
                statIcons={statIcons}
                balancedTuningIcon={balancedTuningIcon}
              />
            }
            manifest={manifest}
          />
        ))}
      </div>
      {/* Loadouts from elsewhere (imports, DIM) carry a mod list but no per-piece placement. */}
      {!modPlacement && loadout.parameters.mods.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="d2-label text-[10px]">Mods</span>
          <div className="flex flex-wrap gap-1">
            {loadout.parameters.mods.map((hash, i) => (
              <PlugIcon key={`${hash}-${i}`} hash={hash} manifest={manifest} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
