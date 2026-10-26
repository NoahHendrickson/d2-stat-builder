<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Changelog rules

The sidebar changelog in `src/lib/changelog.ts` highlights meaningful product updates. A change being visible to users is not enough to warrant an entry.

- Include new features or capabilities, substantial improvements to an existing workflow, and significant fixes to functionality, correctness, reliability, or performance.
- Skip routine UI polish: icon or arrow changes, colors, glows, spacing, alignment, typography, animations, minor layout adjustments, and wording tweaks. For example, a bigger enhanced-perk arrow and green-to-red popularity glows do not belong in the changelog.
- A UI change qualifies when it enables a meaningful task or materially improves usability or accessibility. A cosmetic refresh alone does not.
- Skip refactors, dependency updates, internal tooling, maintenance, and implementation details unless they deliver a qualifying user benefit.
- Before adding an entry, identify the new capability, substantial improvement, or significant problem resolved. If the only benefit is that something looks different or more polished, omit it. When in doubt, leave it out unless the user explicitly requests an entry.
- Do not add a changelog entry for every task, commit, or day. Days with no qualifying changes need no entry. Older entries are not precedent for including minor changes.
- Write one short, plain sentence about the user benefit and where to find it. Combine related changes into one entry per feature rather than listing each implementation adjustment. Describe features on their own terms, without comparisons to other apps.
- Add qualifying changes under their release date (`YYYY-MM-DD`), with one dated group per day, newest first. Never leave an empty group.
