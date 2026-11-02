// The private feedback repo's issues, through GitHub's REST API. Server-only.
//
// FEEDBACK_GITHUB_TOKEN is a fine-grained token with Issues read/write on that one repo
// and nothing else. FEEDBACK_GITHUB_REPO is `owner/name`.
import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/http/safe-equal";
import type { FeedbackIssue } from "./issue-format";

const DEFAULT_REPO = "NoahHendrickson/d2-conflux-feedback";

export interface GithubConfig {
  token: string;
  /** `owner/name`. */
  repo: string;
  /** Just `name`, for "name#12" references. */
  repoName: string;
}

export function githubConfig(): GithubConfig | null {
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token) return null;
  const repo = process.env.FEEDBACK_GITHUB_REPO || DEFAULT_REPO;
  return { token, repo, repoName: repo.slice(repo.indexOf("/") + 1) };
}

async function github<T>(c: GithubConfig, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${c.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${c.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "d2-conflux-feedback",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${init?.method ?? "GET"} ${path} answered ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export interface CreatedIssue {
  number: number;
  html_url: string;
}

export function createIssue(c: GithubConfig, issue: FeedbackIssue): Promise<CreatedIssue> {
  return github<CreatedIssue>(c, "/issues", { method: "POST", body: JSON.stringify(issue) });
}

/** Pages read at most, so a runaway label can't stall a run. */
const MAX_PAGES = 10;

/**
 * Every issue (open and closed, any label, since labels get edited) updated since
 * `since`, which includes every issue created since then. The list endpoint, unlike
 * search, sees an issue the moment it's created, so a sync right after a filing can't
 * repeat it.
 */
export async function recentIssueBodies(c: GithubConfig, since: Date) {
  const out: { number: number; body: string | null }[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      state: "all",
      since: since.toISOString(),
      per_page: "100",
      page: String(page),
    });
    const issues = await github<{ number: number; body: string | null }[]>(c, `/issues?${q}`);
    out.push(...issues);
    if (issues.length < 100) break;
  }
  return out;
}

/** The issue's labels now (a webhook payload's copy can be stale or replayed). */
export async function issueLabels(c: GithubConfig, issue: number): Promise<string[]> {
  const labels = await github<{ name: string }[]>(c, `/issues/${issue}/labels`);
  return labels.map((l) => l.name);
}

export function addLabel(c: GithubConfig, issue: number, label: string) {
  return github<unknown>(c, `/issues/${issue}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: [label] }),
  });
}

/** Checks GitHub's `X-Hub-Signature-256` header against the raw body. */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
}
