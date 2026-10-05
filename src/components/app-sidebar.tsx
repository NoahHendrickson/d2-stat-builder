"use client";

import { memo, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Delete02Icon,
  GarageIcon,
  Layers01Icon,
  LayoutTable01Icon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PencilEdit02Icon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipLabel } from "@/components/ui/tooltip";
import { SidebarStatus } from "@/components/armory/armory-status";
import { LinkDialog } from "@/components/links/link-dialog";
import { LinkFavicon } from "@/components/links/link-favicon";
import { addLink, removeLink, updateLink, useLinks } from "@/lib/links/use-links";
import { useSiteIcon } from "@/lib/site-icon";
import type { SavedLink } from "@/lib/links/links";
import { cn } from "@/lib/utils";

type NavIconProps = { className?: string; strokeWidth?: number };

function navIcon(icon: IconSvgElement): ComponentType<NavIconProps> {
  return function NavIcon(props) {
    return <HugeiconsIcon icon={icon} aria-hidden {...props} />;
  };
}

export const NAV_ITEMS: readonly {
  href: string;
  label: string;
  Icon: ComponentType<NavIconProps>;
  soon?: boolean;
}[] = [
  { href: "/", label: "Stat optimizer", Icon: navIcon(SlidersHorizontalIcon) },
  { href: "/armor", label: "Armor table", Icon: navIcon(LayoutTable01Icon) },
  { href: "/weapons", label: "Weapon search", Icon: navIcon(Search01Icon) },
  { href: "/loadouts", label: "Loadouts", Icon: navIcon(Layers01Icon) },
  { href: "/manager", label: "Items", Icon: navIcon(GarageIcon) },
];

/** Title for the header strip: the nav label of the current route. */
export function pageTitle(pathname: string): string {
  if (pathname === "/settings") return "Settings";
  return NAV_ITEMS.find((n) => n.href === pathname)?.label ?? "";
}

/**
 * The app's navigation column: logo, the five views, the person's own saved links
 * (usually Google Sheets) that open in a new tab, and at the foot their armor, game
 * data, and account. `collapsed` is the icon rail.
 */
export const AppSidebar = memo(function AppSidebar({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  /** Desktop collapse / expand. Omitted in the mobile drawer. */
  onToggle?: () => void;
  /** Called after a nav click (the mobile drawer closes itself). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeIndex = NAV_ITEMS.findIndex((n) => n.href === pathname);
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const siteIcon = useSiteIcon();
  const logo = (
    <Image
      src={siteIcon.src}
      alt=""
      width={28}
      height={28}
      className="size-7 shrink-0 rounded-none"
      unoptimized
      aria-hidden
    />
  );

  return (
    <nav aria-label="Main" className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-3",
          collapsed ? "justify-center" : "pr-2 pl-4",
        )}
      >
        {collapsed && onToggle ? (
          // The rail has no room for both: the logo turns into the expand control on hover.
          <TooltipLabel label={toggleLabel}>
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label={toggleLabel}
              aria-expanded={false}
              onClick={onToggle}
              className="group/brand text-muted-foreground hover:text-foreground"
            >
              <span className="grid place-items-center *:col-start-1 *:row-start-1">
                <span className="transition-opacity group-hover/brand:opacity-0 group-focus-visible/brand:opacity-0">
                  {logo}
                </span>
                <HugeiconsIcon icon={PanelLeftIcon}
                  className="size-4 opacity-0 transition-opacity group-hover/brand:opacity-100 group-focus-visible/brand:opacity-100"
                  aria-hidden
                />
              </span>
            </Button>
          </TooltipLabel>
        ) : (
          logo
        )}
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">D2 Stat Builder</span>
        )}
        {!collapsed && onToggle && (
          <TooltipLabel label={toggleLabel}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={toggleLabel}
              aria-expanded
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-foreground/8"
            >
              <HugeiconsIcon icon={PanelLeftIcon} aria-hidden />
            </Button>
          </TooltipLabel>
        )}
      </div>

      <ul
        className={cn("relative flex shrink-0 flex-col gap-0.5 pb-4", collapsed ? "px-2.5" : "px-2")}
      >
        {/* One highlight that slides between rows (36px + 2px gap) instead of each
            row painting its own, so switching views reads as a move. */}
        <span
          aria-hidden
          className={cn(
            "bg-foreground/8 normal:bg-foreground/6 normal:rounded-[8px] pointer-events-none absolute top-0 h-9 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            collapsed ? "left-2.5 w-9" : "inset-x-2",
            activeIndex < 0 && "opacity-0",
          )}
          style={{ transform: `translateY(${Math.max(activeIndex, 0) * 38}px)` }}
        />
        {NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <NavItem
              {...item}
              active={item.href === pathname}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>

      <div className={cn("d2-rule shrink-0", collapsed ? "mx-3" : "mx-4")} />

      <LinksSection collapsed={collapsed} />

      <SidebarStatus collapsed={collapsed} onNavigate={onNavigate} />
    </nav>
  );
});

/** Shared row look for nav items and links: square, 36px (the nav list draws the active highlight). */
const rowClass =
  "group/row relative flex h-9 items-center gap-3 rounded-none normal:rounded-[8px] text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-outline-strong";

function NavItem({
  href,
  label,
  Icon,
  soon,
  active,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  Icon: ComponentType<NavIconProps>;
  soon?: boolean;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        rowClass,
        collapsed ? "w-9 justify-center" : "px-2.5",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon strokeWidth={active ? 2 : 1.5} className="size-5 shrink-0" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {soon && (
            <span className="d2-label text-muted-foreground/80 shrink-0 text-[10px]">Soon</span>
          )}
        </>
      )}
    </Link>
  );
  return collapsed ? (
    <TooltipLabel label={soon ? `${label} (soon)` : label}>{link}</TooltipLabel>
  ) : (
    link
  );
}

type LinkDialogState = { kind: "closed" } | { kind: "add" } | { kind: "edit"; link: SavedLink };

function LinksSection({ collapsed }: { collapsed: boolean }) {
  const links = useLinks();
  const [dialog, setDialog] = useState<LinkDialogState>({ kind: "closed" });
  const editing = dialog.kind === "edit" ? dialog.link : undefined;

  const addButton = (
    <TooltipLabel label="Add a link">
      <Button
        variant="outline"
        size={collapsed ? "icon" : "icon-xs"}
        aria-label="Add a link"
        onClick={() => setDialog({ kind: "add" })}
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden />
      </Button>
    </TooltipLabel>
  );

  return (
    <section
      aria-label="Links"
      className="flex min-h-0 flex-1 flex-col gap-1 pt-4"
    >
      {collapsed ? (
        <div className="flex justify-center">{addButton}</div>
      ) : (
        // pr-3.5 puts the + over each link's ⋯ (ul px-2 + right-1.5); the list drops
        // d2-scroll's stable gutter so a reserved scrollbar track doesn't push the ⋯ left.
        <div className="flex h-6 shrink-0 items-center justify-between pr-3.5 pl-4">
          <h2 className="d2-label">Links</h2>
          {addButton}
        </div>
      )}

      <ul
        className={cn(
          "d2-scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain [scrollbar-gutter:auto]!",
          collapsed ? "items-center px-2.5" : "px-2",
        )}
      >
        {links.map((link) => (
          <li key={link.id}>
            <LinkRow
              link={link}
              collapsed={collapsed}
              onEdit={() => setDialog({ kind: "edit", link })}
            />
          </li>
        ))}
      </ul>

      {!collapsed && links.length === 0 && (
        <button
          type="button"
          onClick={() => setDialog({ kind: "add" })}
          className="text-muted-foreground hover:text-foreground mx-2 flex items-start gap-3 rounded-none normal:rounded-[8px] px-2.5 py-2 text-left text-sm leading-5 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          <HugeiconsIcon icon={Add01Icon} className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>Pin a spreadsheet or site you use alongside the app</span>
        </button>
      )}

      <LinkDialog
        open={dialog.kind !== "closed"}
        onOpenChange={(open) => !open && setDialog({ kind: "closed" })}
        link={editing}
        onSubmit={(values) => (editing ? updateLink(editing.id, values) : addLink(values))}
      />
    </section>
  );
}

function LinkRow({
  link,
  collapsed,
  onEdit,
}: {
  link: SavedLink;
  collapsed: boolean;
  onEdit: () => void;
}) {
  const anchor = (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={collapsed ? `${link.name} (opens in a new tab)` : undefined}
      className={cn(
        rowClass,
        "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        collapsed ? "w-9 justify-center" : "min-w-0 flex-1 px-2.5 pr-9",
      )}
    >
      {/* 16px favicon in the nav icons' 20px column, so icons and labels line up. */}
      <LinkFavicon url={link.url} className="mx-0.5" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{link.name}</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      )}
    </a>
  );

  if (collapsed) {
    return <TooltipLabel label={link.name}>{anchor}</TooltipLabel>;
  }

  return (
    <div className="group/link relative flex">
      {anchor}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
            />
          }
          aria-label={`Options for ${link.name}`}
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onEdit}>
            <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => removeLink(link.id)}>
            <HugeiconsIcon icon={Delete02Icon} aria-hidden />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
