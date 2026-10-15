/**
 * The sidebar's Changelog, the one place the app announces what's new: what users can
 * do now that they couldn't before, newest first, back to the first release. When a
 * user-facing change ships, add a line to today's entry (or a new entry at the top).
 * Fixes count when a user would notice them; refactors and internals don't. Write for
 * players: what changed and where to find it, not how it works. Describe features on
 * their own terms, never by comparison to another app or site.
 */
export interface ChangelogEntry {
  /** Release day, YYYY-MM-DD. "Seen" tracks it with the line count: a newer top date, or a new line under it, is news. */
  date: string;
  changes: string[];
  /** A video or post that goes with the release. */
  link?: { label: string; href: string };
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: "2026-10-15",
    changes: [
      "Favorite armor: use the heart on an Armor table row (in the row's menu on phones), or open a build in the Stat optimizer and choose Favorite these pieces. Builds show a heart beside their Power, and each favorite piece has one when you open the build. Favorites show on the Items page too.",
      "Loadouts: every loadout's name in a list beside the cards. Click a name to jump to that loadout.",
      "Stat optimizer: Legacy armor now sits under Advanced settings beside Legacy exotics, and works without Power matters on. The checkbox under Power matters is the same setting.",
    ],
  },
  {
    date: "2026-10-14",
    changes: [
      "Legacy raid sets: build with your Armor 2.0 raid armor, Last Wish through Salvation's Edge. Find it under Set bonuses in the Stat optimizer.",
      "This changelog, the one place to see what's new.",
      "Items: character nameplates look like the game's character select, with class, race and Power. The vault gets a nameplate of its own showing how full it is, with your currencies beside it, and stays pinned as you scroll.",
      "Dropdown menus are frosted glass: the page shows through, softly blurred.",
      "Weapon search: clicking a weapon while filter suggestions are open now opens that weapon.",
      "Loadout tooltips say what things do: stat mods read +10 Grenade, and armor mods, aspects, fragments and artifact perks show their descriptions, on the Loadouts page and in Edit.",
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
      "A sidebar with every tool, plus your own links.",
      "Items: move, equip, tag, compare and search all of your gear.",
      "Weapon search across every weapon in the game.",
      "Loadouts get their own page, with weapons, artifacts and in-game slot saving.",
      "Reset buttons on the optimizer's settings sections.",
    ],
    link: { label: "Watch the tour", href: "https://www.youtube.com/watch?v=3u1CGhr0BAE" },
  },
  {
    date: "2026-10-07",
    changes: ["The app is now D2 Conflux, at d2conflux.com."],
  },
  {
    date: "2026-09-26",
    changes: ["Equipping a loadout makes room from your inventory when a slot is full."],
  },
  {
    date: "2026-09-25",
    changes: ["Applying a loadout sets its mods exactly, clearing any it doesn't list."],
  },
  {
    date: "2026-09-24",
    changes: [
      "Dream build: the new Tier 5 rolls that would lift a build to higher stats.",
      "Every set's rolls by archetype, from the grid button on its Set bonuses row.",
    ],
  },
  {
    date: "2026-09-23",
    changes: ["Faster startup, and a snappier optimizer while you drag sliders."],
  },
  {
    date: "2026-09-22",
    changes: ["The optimizer finds every build that reaches your targets, and its stat maximums are exact."],
  },
  {
    date: "2026-09-21",
    changes: ["Smoother scrolling in Firefox."],
  },
  {
    date: "2026-09-19",
    changes: [
      "A new Destiny 2 look.",
      "Build cards show what finishing the masterworks would cost.",
      "Tags on saved loadouts.",
      "Options to include legacy (Armor 2.0) and Tier 1–4 armor in builds.",
    ],
  },
  {
    date: "2026-09-15",
    changes: ["Dreamer's Bond moves into Power matters."],
  },
  {
    date: "2026-09-14",
    changes: [
      "Festival of the Lost masks count toward gear power, and can fill the helmet slot while Power matters is on.",
    ],
  },
  {
    date: "2026-09-13",
    changes: [
      "Saved loadouts: save a build, edit it, and apply it in-game.",
      "Power matters: keep builds inside a gear power range.",
    ],
  },
  {
    date: "2026-07-17",
    changes: ["Search builds without Balanced Tuning mods."],
  },
  {
    date: "2026-07-09",
    changes: [
      "Apply Current copies your equipped fragments into the optimizer.",
      "Sort the optimizer's builds.",
      "The Armor table sorts by more than one column.",
    ],
  },
  {
    date: "2026-07-08",
    changes: ["Pick Spirit perks for an exotic class item, owned or not."],
  },
  {
    date: "2026-07-03",
    changes: [
      "A loading screen with floating exotics while your armor loads.",
      "Long searches keep refining in the background and offer better builds when they find them.",
    ],
  },
  {
    date: "2026-07-02",
    changes: [
      "The Armor table: search, filter, sort and pin filters, plus a feed of new drops.",
      "Legacy exotics, with their artifice +3 mods.",
      "A phone layout for builds.",
      "Set bonus tooltips with each perk's description.",
    ],
  },
  {
    date: "2026-07-01",
    changes: [
      "The first release: an armor stat optimizer with tuning mods, and equipping builds in-game.",
    ],
  },
];
