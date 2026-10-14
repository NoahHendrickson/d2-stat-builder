// The app's top-level views: sidebar label and what "this view is showing its content"
// means on each. Shared by the nav bench and the verify-d2 skill; update it when a route
// is added or a marker's markup changes.
export const ROUTES = [
  { path: "/", nav: "Stat optimizer", marker: '[aria-label="Health target"]' },
  { path: "/armor", nav: "Armor table", marker: "table tbody tr td" },
  { path: "/weapons", nav: "Weapon search", marker: '[aria-label="Weapons"] [role=listitem]' },
  { path: "/loadouts", nav: "Loadouts", marker: '[aria-label^="Search loadouts"]' },
  { path: "/manager", nav: "Items", marker: 'section[aria-label^="Characters"] [role=button][draggable]' },
  // Reached from the account area, not the sidebar list.
  { path: "/settings", nav: null, marker: "#settings-appearance" },
];

export const route = (path) => ROUTES.find((r) => r.path === path.split(/[?#]/)[0]);
