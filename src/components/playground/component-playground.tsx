"use client";

import {
  Component,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowTurnBackwardIcon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipLabel } from "@/components/ui/tooltip";
import { CodeBlock } from "@/components/playground/code-block";
import { useEmbedBridge } from "@/components/playground/embed-bridge";
import { ControlsPanel } from "@/components/playground/controls-panel";
import {
  FORCED_STATES,
  installForcedStates,
  type ForcedState,
} from "@/components/playground/pseudo-states";
import { STORIES } from "@/components/playground/stories";
import { STORY_GROUPS, type ArgValue, type Args, type Story } from "@/components/playground/story";
import { APP_THEMES, setAppTheme, useAppTheme } from "@/lib/app-theme";
import { cn } from "@/lib/utils";

const REPO_BLOB = "https://github.com/NoahHendrickson/d2-stat-builder/blob/main/";

// The open story lives in the URL hash (/components#slider), so a link opens it.
function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function useStoryId(): string {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  return STORIES.some((s) => s.id === hash) ? hash : STORIES[0].id;
}

function openStory(id: string) {
  // replaceState, not location.hash: picking components shouldn't fill the back stack.
  history.replaceState(null, "", `#${id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * /components: every custom control in the app on one page. Pick a component, edit its
 * props in the controls panel, force hover / focus / pressed on the stage, switch the
 * app theme, and copy the JSX the current props produce. `embed` is the copy framed as a
 * full-width band on the portfolio (/components/embed), so it pads like a page section,
 * holds the height of its tallest component, and tells the frame how tall to be.
 */
export function ComponentPlayground({ embed = false }: { embed?: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  const tallest = useTallestStory(embed);
  useEmbedBridge(mainRef, embed, tallest.height != null);
  const storyId = useStoryId();
  const story = STORIES.find((s) => s.id === storyId) ?? STORIES[0];
  // Per-story edits survive switching away and back; Reset drops them.
  const [edits, setEdits] = useState<Record<string, Args>>({});
  const args = { ...story.args, ...edits[story.id] };
  const setArgs = (patch: Partial<Args>) =>
    setEdits((prev) => ({
      ...prev,
      [story.id]: { ...prev[story.id], ...patch } as Args,
    }));

  return (
    <>
      <StoryPage
        ref={mainRef}
        story={story}
        args={args}
        setArgs={setArgs}
        edited={edits[story.id] != null}
        onReset={() =>
          setEdits((prev) => {
            const next = { ...prev };
            delete next[story.id];
            return next;
          })
        }
        embed={embed}
        style={tallest.height ? { minHeight: tallest.height } : undefined}
      />
      {tallest.probe}
    </>
  );
}

const noop = () => {};

/**
 * The embed's frame keeps one height whichever component is open: the tallest one's at
 * its default props. Every story renders once, invisible and inert, at the page's width;
 * the tallest becomes the page's min-height, and the probes unmount. Measured again when
 * the width changes, since narrower means more wrapping.
 */
function useTallestStory(enabled: boolean): { height: number | null; probe: ReactNode } {
  const [width, setWidth] = useState<number | null>(null);
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const probesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(document.documentElement.clientWidth));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [enabled]);

  const probing = enabled && width != null && measured?.width !== width;
  useEffect(() => {
    if (!probing || width == null) return;
    let cancelled = false;
    // After the web font, which changes how the descriptions wrap.
    void document.fonts.ready.then(() => {
      const probes = probesRef.current;
      if (cancelled || !probes) return;
      const height = Math.max(
        ...Array.from(probes.children, (el) => Math.ceil(el.getBoundingClientRect().height)),
      );
      setMeasured({ width, height });
    });
    return () => {
      cancelled = true;
    };
  }, [probing, width]);

  return {
    height: measured?.height ?? null,
    probe: probing ? (
      <div
        ref={probesRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-visible"
      >
        {STORIES.map((s) => (
          <div key={s.id} className="absolute inset-x-0 top-0">
            <StoryPage
              story={s}
              args={s.args}
              setArgs={noop}
              edited={false}
              onReset={noop}
              embed
            />
          </div>
        ))}
      </div>
    ) : null,
  };
}

function StoryPage({
  ref,
  story,
  args,
  setArgs,
  edited,
  onReset,
  embed,
  style,
}: {
  ref?: Ref<HTMLElement>;
  story: Story;
  args: Args;
  setArgs: (patch: Partial<Args>) => void;
  edited: boolean;
  onReset: () => void;
  embed: boolean;
  style?: CSSProperties;
}) {
  return (
    <main
      ref={ref}
      style={style}
      className={cn(
        "mx-auto flex w-full max-w-7xl gap-8 px-4 py-6 lg:px-6",
        embed && "py-8 lg:py-10",
      )}
    >
      <StoryIndex current={story.id} />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <header className="flex flex-col gap-3">
          <StoryPicker current={story.id} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-2xl font-medium normal:font-normal">{story.name}</h2>
            <a
              href={`${REPO_BLOB}${story.source}`}
              target="_blank"
              rel="noreferrer"
              className="d2-hover-ring inline-flex items-center gap-1.5 px-1 font-mono text-xs text-muted-foreground transition-[color,outline-offset] outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-outline-strong normal:rounded-[6px]"
            >
              {story.source}
              <HugeiconsIcon icon={LinkSquare02Icon} className="size-3.5" aria-hidden />
            </a>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{story.description}</p>
        </header>

        <Playground
          key={story.id}
          story={story}
          args={args}
          setArgs={setArgs}
          edited={edited}
          onReset={onReset}
        />

        {story.variants && (
          <section aria-label="Variants" className="flex flex-col gap-3">
            <h3 className="d2-label">Variants</h3>
            <div className="d2-scroll overflow-x-auto border border-foreground/8 p-6 normal:rounded-[20px]">
              {story.variants()}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Playground({
  story,
  args,
  setArgs,
  edited,
  onReset,
}: {
  story: Story;
  args: Args;
  setArgs: (patch: Partial<Args>) => void;
  edited: boolean;
  onReset: () => void;
}) {
  const [forced, setForced] = useState<ForcedState | "live">("live");
  const forcedAttr = FORCED_STATES.find((s) => s.id === forced)?.attr;
  useEffect(() => {
    if (forced !== "live") installForcedStates();
  }, [forced]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={forced} onValueChange={(v) => setForced(v as ForcedState | "live")}>
          <TabsList aria-label="Interaction state">
            <TabsTrigger value="live">Live</TabsTrigger>
            {FORCED_STATES.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ThemeSwitch />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div
          {...(forcedAttr ? { [forcedAttr]: "" } : {})}
          className="d2-scroll flex min-h-80 items-center justify-center overflow-auto border border-foreground/8 bg-[radial-gradient(color-mix(in_srgb,var(--foreground)_9%,transparent)_1px,transparent_1px)] bg-size-[16px_16px] p-10 normal:rounded-[20px]"
        >
          <StageBoundary>{story.render(args, setArgs)}</StageBoundary>
        </div>

        <aside
          aria-label="Props"
          className="flex flex-col gap-4 border border-foreground/8 bg-lifted p-4 normal:rounded-[20px]"
        >
          <div className="flex h-6 items-center justify-between gap-3">
            <h3 className="d2-label">
              Props
            </h3>
            {edited && (
              <TooltipLabel label="Reset props">
                <Button variant="ghost" size="icon-xs" aria-label="Reset props" onClick={onReset}>
                  <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={2} />
                </Button>
              </TooltipLabel>
            )}
          </div>
          <ControlsPanel
            args={args}
            controls={story.controls}
            onChange={(name: string, value: ArgValue) => setArgs({ [name]: value })}
          />
        </aside>
      </div>

      <CodeBlock code={story.code(args)} />
    </div>
  );
}

/** A story that throws shows its error on the stage instead of blanking the page. */
class StageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <p className="text-sm text-destructive">{this.state.error.message}</p>;
    }
    return this.props.children;
  }
}

/** The app theme, right here: the same setting as Settings → Theme. */
function ThemeSwitch() {
  const theme = useAppTheme();
  return (
    <Tabs value={theme} onValueChange={(v) => setAppTheme(String(v))}>
      <TabsList variant="line" aria-label="Theme">
        {APP_THEMES.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** Desktop index: components grouped down the left. */
function StoryIndex({ current }: { current: string }) {
  return (
    <nav
      aria-label="Components"
      className="sticky top-6 hidden w-48 shrink-0 flex-col gap-5 self-start lg:flex"
    >
      {STORY_GROUPS.map((group) => {
        const stories = STORIES.filter((s) => s.group === group);
        if (stories.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="d2-label px-2.5 pb-1">{group}</h3>
            {stories.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={s.id === current ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  openStory(s.id);
                }}
                className={cn(
                  "d2-hover-ring flex h-8 items-center px-2.5 text-sm transition-[color,background-color,outline-offset] outline-none focus-visible:ring-1 focus-visible:ring-outline-strong normal:rounded-[8px]",
                  s.id === current
                    ? "bg-foreground/8 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {s.name}
              </a>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

/** Below `lg` the index folds into a select. */
function StoryPicker({ current }: { current: string }) {
  return (
    <div className="lg:hidden">
      <Select value={current} onValueChange={(v) => v != null && openStory(v)}>
        <SelectTrigger className="w-full sm:w-64" aria-label="Component">
          <SelectValue>
            {(id: string) => STORIES.find((s) => s.id === id)?.name ?? id}
          </SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {STORY_GROUPS.map((group) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {STORIES.filter((s) => s.group === group).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
