import type { ReactNode } from "react";

/** A value a playground control edits. */
export type ArgValue = string | number | boolean;
export type Args = Record<string, ArgValue>;

/** How the controls panel edits one arg. */
export type Control =
  | { type: "select"; options: readonly string[]; label?: string }
  | { type: "boolean"; label?: string }
  | { type: "text"; label?: string }
  | { type: "number"; min: number; max: number; step?: number; label?: string };

export const STORY_GROUPS = ["Controls", "Overlays", "Display", "Destiny"] as const;
export type StoryGroup = (typeof STORY_GROUPS)[number];

/**
 * One component on /components: its live playground (`render` with the current
 * `args`, edited through `controls`), the JSX those args produce, and optionally a
 * gallery of every variant at once.
 */
export interface Story<A extends Args = Args> {
  id: string;
  name: string;
  group: StoryGroup;
  description: string;
  /** Repo path of the component's source. */
  source: string;
  args: A;
  controls: { [K in keyof A]?: Control };
  /** `setArgs` lets a controlled component (a slider, a tab strip) write back. */
  render: (args: A, setArgs: (patch: Partial<A>) => void) => ReactNode;
  code: (args: A) => string;
  variants?: () => ReactNode;
}

/** Keeps each story's args typed while the registry holds them as one list. */
export function defineStory<A extends Args>(story: Story<A>): Story {
  return story as unknown as Story;
}

type JsxProp = string | number | boolean | null | undefined;

/**
 * Formats a JSX snippet: strings as `k="v"`, `true` as a bare `k`, numbers and
 * expressions (wrapped in `{}` by the caller) as `k={…}`; `false`, `null` and
 * `undefined` are left out so defaults don't clutter the snippet.
 */
export function jsx(
  tag: string,
  props: Record<string, JsxProp> = {},
  children?: string,
): string {
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (value === true) attrs.push(key);
    else if (typeof value === "number") attrs.push(`${key}={${value}}`);
    else if (value.startsWith("{")) attrs.push(`${key}=${value}`);
    else attrs.push(`${key}="${value}"`);
  }
  const inline = attrs.length ? ` ${attrs.join(" ")}` : "";
  const open =
    inline.length + tag.length > 64
      ? `<${tag}\n${attrs.map((a) => `  ${a}`).join("\n")}\n`
      : `<${tag}${inline}`;
  if (children == null || children === "") return `${open}${open.endsWith("\n") ? "/>" : " />"}`;
  // Nested elements go on their own lines; plain text stays inline.
  const body = children.includes("\n") || children.startsWith("<")
    ? `\n${children
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n")}\n`
    : children;
  return `${open}>${body}</${tag}>`;
}

/** Leaves a prop out of the snippet when it's at its default. */
export function unlessDefault<T extends JsxProp>(value: T, fallback: T): T | undefined {
  return value === fallback ? undefined : value;
}
