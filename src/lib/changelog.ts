/**
 * The sidebar's Changelog: what users can do now that they couldn't before, newest first.
 * When a user-facing change ships, add a line to today's entry (or a new entry at the
 * top). Fixes count when a user would notice them; refactors and internals don't.
 * Write for players: what changed and where to find it, not how it works.
 */
export interface ChangelogEntry {
  /** Release day, YYYY-MM-DD. Also what "seen" is tracked by: a newer top date is news. */
  date: string;
  changes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: "2026-10-14",
    changes: [
      "Legacy raid sets: build with your Armor 2.0 raid armor, Last Wish through Salvation's Edge. Find it under Set bonuses in the Stat optimizer.",
      "This changelog.",
    ],
  },
  {
    date: "2026-10-13",
    changes: [
      "Theoretical Builds: the Tier 5 rolls to farm for your stat targets, next to your real builds.",
      "Weapon search shows crafted-only perks, like Sticky Grenades on Tarnation.",
    ],
  },
  {
    date: "2026-10-12",
    changes: [
      "Every page works on phones.",
      "Report a bug, in the sidebar.",
      "Exotic class items show both Spirit perks, and the optimizer flags pairs you don't own.",
      "Postmaster items, including tiered Distorted Engrams, all have names.",
    ],
  },
  {
    date: "2026-10-11",
    changes: [
      "Import an in-game loadout as a saved loadout from the + on Loadouts.",
      "The Armor table shows how often the optimizer's searches use each piece, with a Cleanup view.",
      "Weapon stats include the tiered masterwork bonus.",
      "Weapon search has a new look, styled like the D2 roster.",
      "Set bonuses can hide sets you own fewer than 4 pieces of.",
    ],
  },
  {
    date: "2026-10-10",
    changes: [
      "The sidebar: Items, Weapon search and Loadouts, plus your own links.",
      "Reset buttons on the optimizer's settings sections.",
    ],
  },
];
