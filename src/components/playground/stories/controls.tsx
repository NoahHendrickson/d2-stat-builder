"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  LayoutTable01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, SearchClearButton } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { defineStory, jsx, unlessDefault } from "@/components/playground/story";

const BUTTON_VARIANTS = [
  "default",
  "outline",
  "emphatic",
  "ghost",
  "dashed",
  "destructive",
  "link",
] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;
const ICON_SIZES = { xs: "icon-xs", sm: "icon-sm", default: "icon", lg: "icon-lg" } as const;
type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
type ButtonSize = (typeof BUTTON_SIZES)[number];

const button = defineStory({
  id: "button",
  name: "Button",
  group: "Controls",
  description:
    "Square, sentence-case controls. Default is the lifted chip with the centre-bright line, emphatic the green EQUIP plate, dashed the corner-tick well. Hover any of them for the 2px-off selection ring.",
  source: "src/components/ui/button.tsx",
  args: {
    label: "Equip",
    variant: "emphatic",
    size: "default",
    icon: "none",
    disabled: false,
  },
  controls: {
    label: { type: "text" },
    variant: { type: "select", options: BUTTON_VARIANTS },
    size: { type: "select", options: BUTTON_SIZES },
    icon: { type: "select", options: ["none", "leading", "trailing", "icon only"] },
    disabled: { type: "boolean" },
  },
  render: (a) => {
    const size = a.size as ButtonSize;
    const iconOnly = a.icon === "icon only";
    return (
      <Button
        variant={a.variant as ButtonVariant}
        size={iconOnly ? ICON_SIZES[size] : size}
        disabled={a.disabled}
        aria-label={iconOnly ? a.label : undefined}
      >
        {a.icon === "leading" && <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />}
        {iconOnly ? <HugeiconsIcon icon={Add01Icon} /> : a.label}
        {a.icon === "trailing" && (
          <HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />
        )}
      </Button>
    );
  },
  code: (a) => {
    const size = a.size as ButtonSize;
    const iconOnly = a.icon === "icon only";
    const children = iconOnly
      ? "<HugeiconsIcon icon={Add01Icon} />"
      : a.icon === "leading"
        ? `<HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />\n${a.label}`
        : a.icon === "trailing"
          ? `${a.label}\n<HugeiconsIcon icon={ArrowRight01Icon} data-icon="inline-end" />`
          : a.label;
    return jsx(
      "Button",
      {
        variant: unlessDefault(a.variant, "default"),
        size: iconOnly ? ICON_SIZES[size] : unlessDefault(a.size, "default"),
        "aria-label": iconOnly ? a.label : undefined,
        disabled: a.disabled,
      },
      children,
    );
  },
  variants: () => (
    <div className="grid grid-cols-[auto_repeat(4,auto)] items-center justify-start gap-x-6 gap-y-4">
      <span />
      {BUTTON_SIZES.map((s) => (
        <span key={s} className="d2-label">
          {s}
        </span>
      ))}
      {BUTTON_VARIANTS.map((v) => (
        <Row key={v} label={v}>
          {BUTTON_SIZES.map((s) => (
            <Button key={s} variant={v} size={s}>
              Equip
            </Button>
          ))}
        </Row>
      ))}
    </div>
  ),
});

/** A gallery row: its label cell, then the cells; `display: contents` keeps the grid. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const checkbox = defineStory({
  id: "checkbox",
  name: "Checkbox",
  group: "Controls",
  description:
    "Square selection box with the default button's line and hover ring; it fills EQUIP green when checked.",
  source: "src/components/ui/checkbox.tsx",
  args: { label: "Include exotics", checked: true as boolean, size: "default", disabled: false },
  controls: {
    label: { type: "text" },
    checked: { type: "boolean" },
    size: { type: "select", options: ["default", "lg"] },
    disabled: { type: "boolean" },
  },
  render: (a, set) => (
    <label className="flex items-center gap-2.5 text-sm">
      <Checkbox
        checked={a.checked}
        onCheckedChange={(checked) => set({ checked })}
        size={a.size as "default" | "lg"}
        disabled={a.disabled}
      />
      {a.label}
    </label>
  ),
  code: (a) =>
    jsx(
      "label",
      { className: "flex items-center gap-2.5" },
      `${jsx("Checkbox", {
        checked: `{${a.checked}}`,
        onCheckedChange: "{setChecked}",
        size: unlessDefault(a.size, "default"),
        disabled: a.disabled,
      })}\n${a.label}`,
    ),
  variants: () => (
    <div className="flex flex-wrap items-center gap-6">
      <Checkbox />
      <Checkbox defaultChecked />
      <Checkbox size="lg" />
      <Checkbox size="lg" defaultChecked />
      <Checkbox disabled />
      <Checkbox disabled defaultChecked />
    </div>
  ),
});

const switchStory = defineStory({
  id: "switch",
  name: "Switch",
  group: "Controls",
  description:
    "Square toggle: a foreground/16 well that fills with the green gradient when on, with a frosted thumb that springs across.",
  source: "src/components/ui/switch.tsx",
  args: { label: "Record armor usage", checked: true as boolean, size: "default", disabled: false },
  controls: {
    label: { type: "text" },
    checked: { type: "boolean" },
    size: { type: "select", options: ["default", "sm"] },
    disabled: { type: "boolean" },
  },
  render: (a, set) => (
    <label className="flex items-center gap-3 text-sm">
      <Switch
        checked={a.checked}
        onCheckedChange={(checked) => set({ checked })}
        size={a.size as "default" | "sm"}
        disabled={a.disabled}
      />
      {a.label}
    </label>
  ),
  code: (a) =>
    jsx(
      "label",
      { className: "flex items-center gap-3" },
      `${jsx("Switch", {
        checked: `{${a.checked}}`,
        onCheckedChange: "{setChecked}",
        size: unlessDefault(a.size, "default"),
        disabled: a.disabled,
      })}\n${a.label}`,
    ),
  variants: () => (
    <div className="flex flex-wrap items-center gap-6">
      <Switch />
      <Switch defaultChecked />
      <Switch size="sm" />
      <Switch size="sm" defaultChecked />
      <Switch disabled />
      <Switch disabled defaultChecked />
    </div>
  ),
});

const slider = defineStory({
  id: "slider",
  name: "Slider",
  group: "Controls",
  description:
    "The stat-target slider: a 10px well inside a frame 2px out, the green fill, and a 2px thumb. Hover for the value it would snap to; the lighter fill behind is the achievable ceiling.",
  source: "src/components/ui/slider.tsx",
  args: { value: 120, max: 200, step: 5, showCeiling: true, ceiling: 160, disabled: false },
  controls: {
    value: { type: "number", min: 0, max: 300 },
    max: { type: "number", min: 50, max: 300, step: 10 },
    step: { type: "number", min: 1, max: 20 },
    showCeiling: { type: "boolean", label: "Ceiling overlay" },
    ceiling: { type: "number", min: 0, max: 300, step: 5 },
    disabled: { type: "boolean" },
  },
  render: (a, set) => (
    <div className="w-72 py-4">
      <Slider
        value={Math.min(a.value, a.max)}
        max={a.max}
        step={a.step}
        ceiling={a.showCeiling ? Math.min(a.ceiling, a.max) : undefined}
        disabled={a.disabled}
        onValueChange={(v) => set({ value: Array.isArray(v) ? v[0] : v })}
      />
    </div>
  ),
  code: (a) =>
    jsx("Slider", {
      value: "{value}",
      max: unlessDefault(a.max, 100),
      step: unlessDefault(a.step, 1),
      ceiling: a.showCeiling ? Math.min(a.ceiling, a.max) : undefined,
      disabled: a.disabled,
      onValueChange: "{setValue}",
    }),
  variants: () => (
    <div className="flex w-72 flex-col gap-6">
      <Slider defaultValue={40} />
      <Slider defaultValue={60} ceiling={80} />
      <Slider defaultValue={[30, 70]} />
      <Slider defaultValue={50} disabled />
    </div>
  ),
});

const TAB_ITEMS = ["Armor", "Weapons", "Loadouts"] as const;

const tabs = defineStory({
  id: "tabs",
  name: "Tabs",
  group: "Controls",
  description:
    "Tab strips with a sliding indicator. Default and icon slide the green EQUIP plate inside a well; line slides a white underline along a hairline.",
  source: "src/components/ui/tabs.tsx",
  args: { variant: "default", value: "Armor" },
  controls: {
    variant: { type: "select", options: ["default", "icon", "line"] },
    value: { type: "select", options: TAB_ITEMS, label: "Active tab" },
  },
  render: (a, set) => (
    <Tabs value={a.value} onValueChange={(value) => set({ value: String(value) })}>
      <TabsList variant={a.variant as "default" | "icon" | "line"}>
        {a.variant === "icon" ? (
          <>
            <TabsTrigger value="Armor" aria-label="Optimizer">
              <HugeiconsIcon icon={SlidersHorizontalIcon} />
            </TabsTrigger>
            <TabsTrigger value="Weapons" aria-label="Table">
              <HugeiconsIcon icon={LayoutTable01Icon} />
            </TabsTrigger>
          </>
        ) : (
          TAB_ITEMS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))
        )}
      </TabsList>
    </Tabs>
  ),
  code: (a) =>
    jsx(
      "Tabs",
      { value: "{tab}", onValueChange: "{setTab}" },
      jsx(
        "TabsList",
        { variant: unlessDefault(a.variant, "default") },
        TAB_ITEMS.map((t) => jsx("TabsTrigger", { value: t }, t)).join("\n"),
      ),
    ),
  variants: () => (
    <div className="flex flex-col items-start gap-6">
      {(["default", "line"] as const).map((variant) => (
        <Tabs key={variant} defaultValue="Armor">
          <TabsList variant={variant}>
            {TAB_ITEMS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {t}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ))}
    </div>
  ),
});

const CLASSES = ["Hunter", "Titan", "Warlock"] as const;

const select = defineStory({
  id: "select",
  name: "Select",
  group: "Controls",
  description:
    "A field-styled trigger over a frosted glass menu. The trigger shares the button's line, which brightens while the menu is open.",
  source: "src/components/ui/select.tsx",
  args: { value: "Hunter", size: "default", disabled: false },
  controls: {
    value: { type: "select", options: CLASSES },
    size: { type: "select", options: ["sm", "default", "lg"] },
    disabled: { type: "boolean" },
  },
  render: (a, set) => (
    <Select
      value={a.value}
      onValueChange={(v) => v != null && set({ value: v })}
      disabled={a.disabled}
    >
      <SelectTrigger size={a.size as "sm" | "default" | "lg"} className="w-44" aria-label="Class">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CLASSES.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
  code: (a) =>
    jsx(
      "Select",
      { value: "{cls}", onValueChange: "{setCls}", disabled: a.disabled },
      [
        jsx("SelectTrigger", { size: unlessDefault(a.size, "default") }, "<SelectValue />"),
        jsx(
          "SelectContent",
          {},
          CLASSES.map((c) => jsx("SelectItem", { value: c }, c)).join("\n"),
        ),
      ].join("\n"),
    ),
});

const input = defineStory({
  id: "input",
  name: "Input",
  group: "Controls",
  description:
    "Text fields on the lifted fill. Search fields pin the clear button inside the right edge.",
  source: "src/components/ui/input.tsx",
  args: {
    placeholder: "Search weapons",
    clearable: true,
    multiline: false,
    invalid: false,
    disabled: false,
  },
  controls: {
    placeholder: { type: "text" },
    clearable: { type: "boolean", label: "Clear button" },
    multiline: { type: "boolean", label: "Textarea" },
    invalid: { type: "boolean" },
    disabled: { type: "boolean" },
  },
  render: (a) => <InputDemo {...a} />,
  code: (a) =>
    a.multiline
      ? jsx("Textarea", {
          placeholder: a.placeholder,
          "aria-invalid": a.invalid,
          disabled: a.disabled,
        })
      : a.clearable
        ? jsx(
            "div",
            { className: "relative" },
            [
              jsx("Input", {
                type: "search",
                className: "pr-8",
                placeholder: a.placeholder,
                value: "{query}",
                "aria-invalid": a.invalid,
                disabled: a.disabled,
              }),
              "{query && <SearchClearButton onClick={() => setQuery(\"\")} />}",
            ].join("\n"),
          )
        : jsx("Input", {
            placeholder: a.placeholder,
            "aria-invalid": a.invalid,
            disabled: a.disabled,
          }),
});

function InputDemo({
  placeholder,
  clearable,
  multiline,
  invalid,
  disabled,
}: {
  placeholder: string;
  clearable: boolean;
  multiline: boolean;
  invalid: boolean;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("Fatebringer");
  if (multiline) {
    return (
      <Textarea
        className="w-72"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        disabled={disabled}
      />
    );
  }
  return (
    <div className="relative w-72">
      <Input
        type="search"
        className={clearable ? "pr-8" : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-invalid={invalid || undefined}
        disabled={disabled}
      />
      {clearable && query && (
        <SearchClearButton aria-label="Clear search" onClick={() => setQuery("")} />
      )}
    </div>
  );
}

export const CONTROL_STORIES = [button, checkbox, switchStory, slider, tabs, select, input];
