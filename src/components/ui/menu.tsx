"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

const menuPopupClasses =
  "origin-(--transform-origin) rounded-lg bg-popover text-popover-foreground shadow-lg shadow-black/10 ring-1 ring-foreground/10 duration-100 dark:shadow-[0_8px_24px_rgb(0_0_0/0.55),0_2px_8px_rgb(0_0_0/0.35)] data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

function MenuPopup({
  className,
  ...props
}: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-popup"
      className={cn(menuPopupClasses, className)}
      {...props}
    />
  );
}

function MenuPositioner({
  className,
  sideOffset = 4,
  ...props
}: MenuPrimitive.Positioner.Props) {
  return (
    <MenuPrimitive.Positioner
      data-slot="menu-positioner"
      sideOffset={sideOffset}
      className={cn("isolate z-50", className)}
      {...props}
    />
  );
}

function MenuSubmenuTrigger({
  className,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="menu-submenu-trigger"
      className={cn(
        "hover:bg-accent focus-visible:bg-accent flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none",
        className,
      )}
      {...props}
    />
  );
}

const Menu = {
  Root: MenuPrimitive.Root,
  Trigger: MenuPrimitive.Trigger,
  Portal: MenuPrimitive.Portal,
  Positioner: MenuPositioner,
  Popup: MenuPopup,
  SubmenuRoot: MenuPrimitive.SubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
  Separator: MenuPrimitive.Separator,
};

export { Menu };
