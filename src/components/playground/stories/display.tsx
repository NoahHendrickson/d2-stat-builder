"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClassGlyph } from "@/components/class-glyph";
import { EnhancedArrow } from "@/components/enhanced-arrow";
import { FavoriteHeart } from "@/components/favorite-heart";
import { PixelDissolve } from "@/components/loading/pixel-dissolve";
import { PowerValue } from "@/components/power-value";
import { SectionHeading } from "@/components/section-heading";
import { defineStory, jsx, unlessDefault } from "@/components/playground/story";

const BADGE_VARIANTS = [
  "default",
  "emphatic",
  "destructive",
  "outline",
  "exotic",
  "ghost",
  "link",
] as const;
type BadgeVariant = (typeof BADGE_VARIANTS)[number];

const badge = defineStory({
  id: "badge",
  name: "Badge",
  group: "Display",
  description: "Small uppercase tags in the display face; Normal turns them into rounded pills.",
  source: "src/components/ui/badge.tsx",
  args: { label: "Exotic", variant: "exotic" },
  controls: {
    label: { type: "text" },
    variant: { type: "select", options: BADGE_VARIANTS },
  },
  render: (a) => <Badge variant={a.variant as BadgeVariant}>{a.label}</Badge>,
  code: (a) => jsx("Badge", { variant: unlessDefault(a.variant, "default") }, a.label),
  variants: () => (
    <div className="flex flex-wrap items-center gap-3">
      {BADGE_VARIANTS.map((v) => (
        <Badge key={v} variant={v}>
          {v}
        </Badge>
      ))}
    </div>
  ),
});

const card = defineStory({
  id: "card",
  name: "Card",
  group: "Display",
  description:
    "Section card on the lifted fill, with a title rule that fades out to the right.",
  source: "src/components/ui/card.tsx",
  args: {
    title: "Hunter build",
    description: "Weapons 200, Grenade 150, Class 100",
    size: "default",
    footer: true,
  },
  controls: {
    title: { type: "text" },
    description: { type: "text" },
    size: { type: "select", options: ["default", "sm"] },
    footer: { type: "boolean" },
  },
  render: (a) => (
    <Card size={a.size as "default" | "sm"} className="w-80">
      <CardHeader>
        <CardTitle>{a.title}</CardTitle>
        <CardDescription>{a.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <PowerValue value={2010} size="lg" tone="gold" />
      </CardContent>
      {a.footer && (
        <CardFooter className="justify-end gap-2">
          <Button variant="emphatic" size="sm">
            Equip
          </Button>
        </CardFooter>
      )}
    </Card>
  ),
  code: (a) =>
    jsx(
      "Card",
      { size: unlessDefault(a.size, "default") },
      [
        jsx(
          "CardHeader",
          {},
          [jsx("CardTitle", {}, a.title), jsx("CardDescription", {}, a.description)].join("\n"),
        ),
        jsx("CardContent", {}, "…"),
        ...(a.footer ? [jsx("CardFooter", {}, jsx("Button", { variant: "emphatic" }, "Equip"))] : []),
      ].join("\n"),
    ),
});

const sectionHeading = defineStory({
  id: "section-heading",
  name: "Section heading",
  group: "Display",
  description: "Sentence-case section title with an optional trailing slot.",
  source: "src/components/section-heading.tsx",
  args: { title: "Set bonuses", trailing: true },
  controls: {
    title: { type: "text" },
    trailing: { type: "boolean", label: "Trailing badge" },
  },
  render: (a) => (
    <SectionHeading trailing={a.trailing ? <Badge variant="outline">2 of 4</Badge> : undefined}>
      {a.title}
    </SectionHeading>
  ),
  code: (a) =>
    jsx(
      "SectionHeading",
      { trailing: a.trailing ? '{<Badge variant="outline">2 of 4</Badge>}' : undefined },
      a.title,
    ),
});

const POWER_SIZES = ["xs", "sm", "lg", "xl"] as const;

const powerValue = defineStory({
  id: "power-value",
  name: "Power value",
  group: "Destiny",
  description:
    "The game's Power readout: the hollow light-level diamond beside a tabular number, in cyan or the light-level gold.",
  source: "src/components/power-value.tsx",
  args: { value: 2010, size: "lg", tone: "gold", muted: false },
  controls: {
    value: { type: "number", min: 1, max: 2010 },
    size: { type: "select", options: POWER_SIZES },
    tone: { type: "select", options: ["cyan", "gold"] },
    muted: { type: "boolean" },
  },
  render: (a) => (
    <PowerValue
      value={a.value}
      size={a.size as (typeof POWER_SIZES)[number]}
      tone={a.tone as "cyan" | "gold"}
      muted={a.muted}
    />
  ),
  code: (a) =>
    jsx("PowerValue", {
      value: a.value,
      size: unlessDefault(a.size, "sm"),
      tone: unlessDefault(a.tone, "cyan"),
      muted: a.muted,
    }),
  variants: () => (
    <div className="flex flex-wrap items-baseline gap-6">
      {POWER_SIZES.map((s) => (
        <PowerValue key={s} value={2010} size={s} tone="gold" />
      ))}
      <PowerValue value={1995} />
      <PowerValue value={1950} muted />
    </div>
  ),
});

const CLASS_TYPES = { Titan: 0, Hunter: 1, Warlock: 2 } as const;

const classGlyph = defineStory({
  id: "class-glyph",
  name: "Class glyph",
  group: "Destiny",
  description: "Titan, Hunter and Warlock sigils, drawn in the surrounding text colour.",
  source: "src/components/class-glyph.tsx",
  args: { classType: "Hunter", height: 32 },
  controls: {
    classType: { type: "select", options: Object.keys(CLASS_TYPES), label: "Class" },
    height: { type: "number", min: 12, max: 96, step: 4 },
  },
  render: (a) => (
    <ClassGlyph
      classType={CLASS_TYPES[a.classType as keyof typeof CLASS_TYPES]}
      style={{ height: a.height, width: "auto" }}
    />
  ),
  code: (a) =>
    jsx("ClassGlyph", {
      classType: CLASS_TYPES[a.classType as keyof typeof CLASS_TYPES],
      className: a.height === 16 ? undefined : `h-[${a.height}px] w-auto`,
    }),
  variants: () => (
    <div className="flex items-center gap-6">
      {Object.values(CLASS_TYPES).map((t) => (
        <ClassGlyph key={t} classType={t} className="h-8 w-auto" />
      ))}
    </div>
  ),
});

const enhancedArrow = defineStory({
  id: "enhanced-arrow",
  name: "Enhanced arrow",
  group: "Destiny",
  description: "The enhanced-perk arrow: a solid head over a stem whose fill fades out.",
  source: "src/components/enhanced-arrow.tsx",
  args: { size: 40, gold: true },
  controls: {
    size: { type: "number", min: 8, max: 96, step: 4 },
    gold: { type: "boolean" },
  },
  render: (a) => (
    <EnhancedArrow
      className={a.gold ? "text-power-gold" : "text-foreground"}
      style={{ width: a.size, height: a.size }}
    />
  ),
  code: (a) =>
    jsx("EnhancedArrow", {
      className: `size-[${a.size}px]${a.gold ? " text-power-gold" : ""}`,
    }),
});

const favoriteHeart = defineStory({
  id: "favorite-heart",
  name: "Favorite heart",
  group: "Destiny",
  description: "The Favorite tag's duotone heart; the outline alone while a toggle is off.",
  source: "src/components/favorite-heart.tsx",
  args: { filled: true, size: 32 },
  controls: {
    filled: { type: "boolean" },
    size: { type: "number", min: 12, max: 96, step: 4 },
  },
  render: (a) => (
    <span style={{ width: a.size, height: a.size }} className="inline-flex">
      <FavoriteHeart filled={a.filled} className="size-full" />
    </span>
  ),
  code: (a) =>
    jsx("FavoriteHeart", {
      filled: a.filled ? undefined : "{false}",
      className: `size-[${a.size}px]`,
    }),
});

const pixelDissolve = defineStory({
  id: "pixel-dissolve",
  name: "Pixel dissolve",
  group: "Destiny",
  description:
    "The loader: each site icon dissolves into the next one random pixel at a time, kept crisp at any size.",
  source: "src/components/loading/pixel-dissolve.tsx",
  args: { size: 144 },
  controls: {
    size: { type: "number", min: 48, max: 288, step: 24 },
  },
  render: (a) => (
    <div style={{ width: a.size, height: a.size }}>
      <PixelDissolve className="size-full" />
    </div>
  ),
  code: (a) => jsx("PixelDissolve", { className: a.size === 144 ? "size-36" : `size-[${a.size}px]` }),
});

export const DISPLAY_STORIES = [
  badge,
  card,
  sectionHeading,
  powerValue,
  classGlyph,
  enhancedArrow,
  favoriteHeart,
  pixelDissolve,
];
