"use client";

import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ArrowDown01Icon,
  BookmarkAdd02Icon,
  Bookmark02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { ConfirmDialog } from "@/components/loadouts/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TooltipLabel } from "@/components/ui/tooltip";
import { CLASS_NAMES } from "@/lib/armory/stats";
import {
  cleanTheoryBuildName,
  findTheoryBuild,
  loadSavedTheoryBuilds,
  withoutTheoryBuild,
  withTheoryBuild,
  writeSavedTheoryBuilds,
  type SavedTheoryBuild,
  type TheoryInputs,
} from "@/lib/builder/theory-storage";
import { MAX_NAME_LENGTH } from "@/lib/loadouts/types";
import { toast } from "@/lib/toast";

/**
 * The Theoretical tab's saved builds, kept in this browser (theory-storage.ts). The first
 * item saves the current inputs under a name; picking a build loads its inputs.
 */
export function SavedTheoryBuildsMenu({
  getCurrent,
  onLoad,
}: {
  /** The tab's inputs now, read when a save is confirmed. */
  getCurrent: () => TheoryInputs;
  onLoad: (build: SavedTheoryBuild) => void;
}) {
  const [builds, setBuilds] = useState(loadSavedTheoryBuilds);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // A save waiting on "Replace" because its name is taken. Kept after the confirm closes,
  // so its title doesn't change while it animates out.
  const [replacing, setReplacing] = useState<SavedTheoryBuild | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Re-read before each write, so a save in another browser tab isn't lost.
  const commit = (update: (list: SavedTheoryBuild[]) => SavedTheoryBuild[]) => {
    const next = update(loadSavedTheoryBuilds());
    writeSavedTheoryBuilds(next);
    setBuilds(next);
  };

  const save = (build: SavedTheoryBuild) => {
    commit((list) => withTheoryBuild(list, build));
    toast.success(`Saved ${build.name}`);
  };

  const clean = cleanTheoryBuildName(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    const build = { name: clean, ...getCurrent() };
    setNaming(false);
    if (!findTheoryBuild(loadSavedTheoryBuilds(), clean)) return save(build);
    setReplacing(build);
    setConfirming(true);
  };

  const remove = (build: SavedTheoryBuild) => {
    commit((list) => withoutTheoryBuild(list, build.name));
    toast.success(`Deleted ${build.name}`);
  };

  return (
    <>
      <DropdownMenu>
        {/* h-auto: stretches to the tab track beside it (see BuildsColumnContent). */}
        <DropdownMenuTrigger
          aria-label="Save or load builds"
          render={<Button variant="outline" className="h-auto" />}
        >
          <HugeiconsIcon icon={Bookmark02Icon} data-icon="inline-start" aria-hidden />
          <span className="max-sm:sr-only">Save</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            data-icon="inline-end"
            className="text-muted-foreground"
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
          {/* The primary action, as the green button rather than a menu row. */}
          <MenuPrimitive.Item
            nativeButton
            render={<Button variant="emphatic" className="w-full" />}
            onClick={() => {
              setName("");
              setNaming(true);
            }}
          >
            <HugeiconsIcon icon={BookmarkAdd02Icon} data-icon="inline-start" aria-hidden />
            Save current build
          </MenuPrimitive.Item>
          {builds.length > 0 && <DropdownMenuSeparator />}
          {builds.map((build) => {
            const className =
              build.classType === null ? undefined : CLASS_NAMES[build.classType];
            return (
              <DropdownMenuItem
                key={build.name}
                className="pr-0.5"
                onClick={() => onLoad(build)}
                onKeyDown={(e) => {
                  if (e.key === "Delete" || e.key === "Backspace") remove(build);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{build.name}</span>
                {className && (
                  <span className="text-muted-foreground shrink-0 text-xs">{className}</span>
                )}
                <TooltipLabel label={`Delete ${build.name}`}>
                  {/* The app's small icon button, as on the toast close. */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${build.name}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(build);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
                  </Button>
                </TooltipLabel>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-md">
          <form className="contents" onSubmit={submit}>
            <DialogHeader className="pr-8">
              <DialogTitle>Save theoretical build</DialogTitle>
            </DialogHeader>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              aria-label="Build name"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNaming(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!clean}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Replace ${replacing?.name ?? ""}?`}
        description="A saved build already has this name."
        confirmLabel="Replace"
        onConfirm={() => {
          if (replacing) save(replacing);
          setConfirming(false);
        }}
      />
    </>
  );
}
