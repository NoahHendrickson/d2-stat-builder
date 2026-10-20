/**
 * The data repo (NoahHendrickson/d2-conflux-data): snapshots its crawls rebuild
 * several times a day, served by GitHub Pages, so serving them costs Vercel
 * nothing. CSP connect-src allows the host (next.config.ts).
 */
export const DATA_REPO_BASE = "https://noahhendrickson.github.io/d2-conflux-data/";

/** Where a data repo snapshot is published. */
export const dataRepoUrl = (file: string) => `${DATA_REPO_BASE}${file}`;
