// Armor usage history is paused: one row per piece per search filled most of the
// Neon storage (349 of 380 MB after 12 days, ~30 MB a day). While this is on, the
// server neither writes nor reads it, the optimizer sends nothing, and the Searches
// column, Cleanup view and Settings section are hidden. Clearing still works.
export const BUILD_USAGE_PAUSED = true;
