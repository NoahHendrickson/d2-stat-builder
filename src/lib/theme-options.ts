import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";

/** next-themes values, as offered in Settings and the profile menu. */
export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon },
] as const;
