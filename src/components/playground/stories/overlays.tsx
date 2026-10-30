"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/lib/toast";
import { defineStory, jsx, unlessDefault } from "@/components/playground/story";

const SIDES = ["top", "right", "bottom", "left"] as const;
const ALIGNS = ["start", "center", "end"] as const;
type Side = (typeof SIDES)[number];
type Align = (typeof ALIGNS)[number];

const tooltip = defineStory({
  id: "tooltip",
  name: "Tooltip",
  group: "Overlays",
  description:
    "Frosted label on the glass surface. A held finger opens it on touch screens.",
  source: "src/components/ui/tooltip.tsx",
  // Closed by default: the embed renders every story invisibly to measure the tallest,
  // and an open tooltip would portal out of that probe onto the page.
  args: { label: "Masterwork costs 3 Ascendant Shards", side: "top", open: false as boolean },
  controls: {
    label: { type: "text" },
    side: { type: "select", options: SIDES },
    open: { type: "boolean", label: "Keep open" },
  },
  render: (a) => (
    <Tooltip open={a.open || undefined}>
      <TooltipTrigger render={<Button variant="outline" />}>Hover me</TooltipTrigger>
      <TooltipContent side={a.side as Side}>{a.label}</TooltipContent>
    </Tooltip>
  ),
  code: (a) =>
    jsx(
      "Tooltip",
      {},
      [
        jsx("TooltipTrigger", { render: '{<Button variant="outline" />}' }, "Hover me"),
        jsx("TooltipContent", { side: unlessDefault(a.side, "top") }, a.label),
      ].join("\n"),
    ),
});

const popover = defineStory({
  id: "popover",
  name: "Popover",
  group: "Overlays",
  description: "A glass panel anchored to its trigger, for small forms and details.",
  source: "src/components/ui/popover.tsx",
  args: {
    title: "Power range",
    description: "Builds only use armor inside this Power range.",
    side: "bottom",
    align: "center",
  },
  controls: {
    title: { type: "text" },
    description: { type: "text" },
    side: { type: "select", options: SIDES },
    align: { type: "select", options: ALIGNS },
  },
  render: (a) => (
    <Popover>
      <PopoverTrigger render={<Button />}>Open popover</PopoverTrigger>
      <PopoverContent side={a.side as Side} align={a.align as Align}>
        <PopoverHeader>
          <PopoverTitle>{a.title}</PopoverTitle>
          <PopoverDescription>{a.description}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
  code: (a) =>
    jsx(
      "Popover",
      {},
      [
        jsx("PopoverTrigger", { render: "{<Button />}" }, "Open popover"),
        jsx(
          "PopoverContent",
          { side: unlessDefault(a.side, "bottom"), align: unlessDefault(a.align, "center") },
          jsx(
            "PopoverHeader",
            {},
            [
              jsx("PopoverTitle", {}, a.title),
              jsx("PopoverDescription", {}, a.description),
            ].join("\n"),
          ),
        ),
      ].join("\n"),
    ),
});

const dropdownMenu = defineStory({
  id: "dropdown-menu",
  name: "Dropdown menu",
  group: "Overlays",
  description:
    "Frosted menu with plain items, checkbox and radio items, and a destructive action.",
  source: "src/components/ui/dropdown-menu.tsx",
  args: { side: "bottom", align: "start", destructive: true },
  controls: {
    side: { type: "select", options: SIDES },
    align: { type: "select", options: ALIGNS },
    destructive: { type: "boolean", label: "Delete item" },
  },
  render: (a) => <DropdownDemo side={a.side as Side} align={a.align as Align} destructive={a.destructive} />,
  code: (a) =>
    jsx(
      "DropdownMenu",
      {},
      [
        jsx("DropdownMenuTrigger", { render: '{<Button variant="outline" />}' }, "Loadout"),
        jsx(
          "DropdownMenuContent",
          { side: unlessDefault(a.side, "bottom"), align: unlessDefault(a.align, "start") },
          [
            jsx("DropdownMenuItem", {}, "Rename"),
            jsx("DropdownMenuCheckboxItem", { checked: "{pinned}", onCheckedChange: "{setPinned}" }, "Pinned"),
            ...(a.destructive
              ? ["<DropdownMenuSeparator />", jsx("DropdownMenuItem", { variant: "destructive" }, "Delete")]
              : []),
          ].join("\n"),
        ),
      ].join("\n"),
    ),
});

function DropdownDemo({
  side,
  align,
  destructive,
}: {
  side: Side;
  align: Align;
  destructive: boolean;
}) {
  const [pinned, setPinned] = useState(true);
  const [sort, setSort] = useState("power");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Loadout
        <HugeiconsIcon icon={MoreHorizontalIcon} data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align}>
        <DropdownMenuItem>Rename</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
          Pinned
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioItem value="power">Power</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {destructive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <HugeiconsIcon icon={Delete02Icon} />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const dialog = defineStory({
  id: "dialog",
  name: "Dialog",
  group: "Overlays",
  description: "Modal on the slate surface, with an optional footer bar.",
  source: "src/components/ui/dialog.tsx",
  args: {
    title: "Delete loadout?",
    description: "This removes it from D2 Conflux. Your in-game loadouts stay as they are.",
    footer: true,
    closeButton: true,
  },
  controls: {
    title: { type: "text" },
    description: { type: "text" },
    footer: { type: "boolean" },
    closeButton: { type: "boolean", label: "Close button" },
  },
  render: (a) => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Open dialog</DialogTrigger>
      <DialogContent showCloseButton={a.closeButton}>
        <DialogHeader>
          <DialogTitle>{a.title}</DialogTitle>
          <DialogDescription>{a.description}</DialogDescription>
        </DialogHeader>
        {a.footer && (
          <DialogFooter showCloseButton>
            <Button variant="destructive">Delete</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  ),
  code: (a) =>
    jsx(
      "Dialog",
      {},
      [
        jsx("DialogTrigger", { render: '{<Button variant="outline" />}' }, "Open dialog"),
        jsx(
          "DialogContent",
          { showCloseButton: a.closeButton ? undefined : "{false}" },
          [
            jsx(
              "DialogHeader",
              {},
              [jsx("DialogTitle", {}, a.title), jsx("DialogDescription", {}, a.description)].join("\n"),
            ),
            ...(a.footer
              ? [jsx("DialogFooter", { showCloseButton: true }, jsx("Button", { variant: "destructive" }, "Delete"))]
              : []),
          ].join("\n"),
        ),
      ].join("\n"),
    ),
});

const drawer = defineStory({
  id: "drawer",
  name: "Drawer",
  group: "Overlays",
  description:
    "A swipeable sheet from any edge: the loadout editor on desktop, the menu and filters on phones.",
  source: "src/components/ui/drawer.tsx",
  args: { swipeDirection: "right", title: "Edit loadout" },
  controls: {
    swipeDirection: { type: "select", options: ["down", "up", "left", "right"], label: "From edge" },
    title: { type: "text" },
  },
  render: (a) => {
    const direction = a.swipeDirection as "down" | "up" | "left" | "right";
    return (
      <Drawer swipeDirection={direction}>
        <DrawerTrigger render={<Button variant="outline" />}>Open drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{a.title}</DrawerTitle>
            <DrawerDescription>Swipe it back toward its edge to close.</DrawerDescription>
          </DrawerHeader>
          <div className="flex-1" />
          <DrawerFooter>
            <Button variant="emphatic">Save</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  },
  code: (a) =>
    jsx(
      "Drawer",
      { swipeDirection: unlessDefault(a.swipeDirection, "down") },
      [
        jsx("DrawerTrigger", { render: '{<Button variant="outline" />}' }, "Open drawer"),
        jsx(
          "DrawerContent",
          {},
          jsx("DrawerHeader", {}, jsx("DrawerTitle", {}, a.title)),
        ),
      ].join("\n"),
    ),
});

const TOAST_TYPES = ["success", "error", "warning", "info", "loading"] as const;

const toastStory = defineStory({
  id: "toast",
  name: "Toast",
  group: "Overlays",
  description:
    "Stacked notices in the corner. A loading toast turns into its outcome in place.",
  source: "src/components/ui/toast.tsx",
  args: { type: "success", title: "Loadout applied", description: "Hunter, 6 of 6 pieces equipped." },
  controls: {
    type: { type: "select", options: TOAST_TYPES },
    title: { type: "text" },
    description: { type: "text" },
  },
  render: (a) => (
    <Button
      variant="outline"
      onClick={() => {
        const description = a.description || undefined;
        if (a.type === "loading") {
          const pending = toast.loading(a.title, description);
          setTimeout(() => pending.success("Done", description), 1600);
        } else {
          toast[a.type as Exclude<(typeof TOAST_TYPES)[number], "loading">](a.title, description);
        }
      }}
    >
      Show toast
    </Button>
  ),
  code: (a) =>
    a.type === "loading"
      ? `const pending = toast.loading(${JSON.stringify(a.title)})\n// …later\npending.success("Done")`
      : `toast.${a.type}(${JSON.stringify(a.title)}${a.description ? `, ${JSON.stringify(a.description)}` : ""})`,
});

export const OVERLAY_STORIES = [tooltip, popover, dropdownMenu, dialog, drawer, toastStory];
