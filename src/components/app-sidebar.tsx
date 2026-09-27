"use client";

import { memo, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Crosshair,
  DotsThree,
  PencilSimple,
  Plus,
  SidebarSimple,
  SlidersHorizontal,
  Stack,
  Table,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipLabel } from "@/components/ui/tooltip";
import { LinkDialog } from "@/components/links/link-dialog";
import { LinkFavicon } from "@/components/links/link-favicon";
import { addLink, removeLink, updateLink, useLinks } from "@/lib/links/use-links";
import type { SavedLink } from "@/lib/links/links";
import { cn } from "@/lib/utils";

export const NAV_ITEMS: readonly {
  href: string;
  label: string;
  Icon: Icon;
  soon?: boolean;
}[] = [
  { href: "/", label: "Stat optimizer", Icon: SlidersHorizontal },
  { href: "/armor", label: "Armor table", Icon: Table },
  { href: "/weapons", label: "Weapon search", Icon: Crosshair, soon: true },
  { href: "/loadouts", label: "Loadouts", Icon: Stack },
];

/** Title for the header strip: the nav label of the current route. */
export function pageTitle(pathname: string): string {
  return NAV_ITEMS.find((n) => n.href === pathname)?.label ?? "";
}

/** Height of the sidebar's brand row and the main column's header, so they line up. */
export const APP_HEADER_HEIGHT = "h-16";

/**
 * The app's navigation column: logo, the four views, and the person's own saved links
 * (usually Google Sheets) that open in a new tab. `collapsed` is the icon rail.
 */
export const AppSidebar = memo(function AppSidebar({
  collapsed = false,
  onToggle,
  onNavigate,
  footer,
}: {
  collapsed?: boolean;
  /** Desktop collapse / expand. Omitted in the mobile drawer. */
  onToggle?: () => void;
  /** Called after a nav click (the mobile drawer closes itself). */
  onNavigate?: () => void;
  footer?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          APP_HEADER_HEIGHT,
          "flex shrink-0 items-center gap-3",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        <Image
          src="/sidebar-logo.svg"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0 rounded-none"
          unoptimized
          aria-hidden
        />
        {!collapsed && (
          <span className="min-w-0 truncate text-sm font-medium">D2 Stat Builder</span>
        )}
      </div>

      <ul className={cn("flex shrink-0 flex-col gap-0.5 pb-4", collapsed ? "px-2.5" : "px-2")}>
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

      {footer}

      {onToggle && (
        <div className={cn("shrink-0 py-3", collapsed ? "flex justify-center" : "px-2")}>
          <TooltipLabel label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              onClick={onToggle}
              className="text-muted-foreground hover:text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-foreground/8"
            >
              <SidebarSimple aria-hidden />
            </Button>
          </TooltipLabel>
        </div>
      )}
    </nav>
  );
});

/** Shared row look for nav items and links: square, 36px, white/8 when active. */
const rowClass =
  "group/row relative flex h-9 items-center gap-3 rounded-none text-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-outline-strong";

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
  Icon: Icon;
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
          ? "bg-foreground/8 text-foreground shadow-[inset_0_0_0_1px] shadow-foreground/8"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      {/* The active marker: a short bar on the leading edge, like the game's selected tab. */}
      {active && (
        <span aria-hidden className="bg-foreground absolute top-2 bottom-2 left-0 w-0.5" />
      )}
      <Icon weight={active ? "fill" : "duotone"} className="size-4 shrink-0" aria-hidden />
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
        variant="ghost"
        size={collapsed ? "icon" : "icon-xs"}
        aria-label="Add a link"
        onClick={() => setDialog({ kind: "add" })}
        className="text-muted-foreground hover:text-foreground"
      >
        <Plus weight="bold" aria-hidden />
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
        <div className="flex h-6 shrink-0 items-center justify-between pr-3 pl-4">
          <h2 className="d2-label">Links</h2>
          {addButton}
        </div>
      )}

      <ul
        className={cn(
          "d2-scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain",
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
          className="text-muted-foreground hover:text-foreground mx-2 flex items-start gap-3 rounded-none px-2.5 py-2 text-left text-sm leading-5 outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-1 focus-visible:ring-outline-strong"
        >
          <Plus className="mt-0.5 size-4 shrink-0" aria-hidden />
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
      <LinkFavicon url={link.url} />
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
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
            />
          }
          aria-label={`Options for ${link.name}`}
        >
          <DotsThree weight="bold" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onEdit}>
            <PencilSimple aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => removeLink(link.id)}>
            <Trash aria-hidden />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
