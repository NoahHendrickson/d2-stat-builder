<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Changelog rules

`src/lib/changelog.ts` lists meaningful product updates, not everything users can see. The whole changelog follows these rules, so remove an old line that breaks them rather than copying it.

- **Add a line for** a new capability, a substantial workflow improvement, or a significant fix to correctness, reliability or performance. UI changes count only when they enable a task or materially improve usability or accessibility.
- **Skip** cosmetic polish (a bigger perk arrow, a new glow colour, spacing, typography, animation, a restyle, wording), refactors, dependencies and internal tooling. When in doubt, leave it out unless the user asks for an entry.
- **Wording:** one short, plain sentence about the benefit and where to find it. Use one line per feature, not one per adjustment, and don't compare features to other apps.
- **Placement:** group lines under their release date (`YYYY-MM-DD`), newest first. Not every day needs a group. `changelog.test.ts` rejects empty ones.
