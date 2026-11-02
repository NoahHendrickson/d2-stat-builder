// The private feedback repo's issues, through GitHub's REST API. Server-only.
//
// FEEDBACK_GITHUB_TOKEN is a fine-grained token with Issues read/write on that one repo
// and nothing else. FEEDBACK_GITHUB_REPO is `owner/name`.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FeedbackIssue } from "./issue-format";

const DEFAULT_REPO = "NoahHendrickson/d2-conflux-feedback";

export interface GithubConfig {
  token: string;
  repo: string;
}

export function githubConfig(): GithubConfig | null {
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token) return null;
  return { token, repo: process.env.FEEDBACK_GITHUB_REPO || DEFAULT_REPO };
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

/**
 * The newest issues (open and closed) with `label`. The list endpoint, unlike search,
 * sees an issue the moment it's created, so a sync right after a filing can't repeat it.
 */
export function recentIssueBodies(c: GithubConfig, label: string, count = 100) {
  const q = new URLSearchParams({
    labels: label,
    state: "all",
    sort: "created",
    direction: "desc",
    per_page: String(Math.min(count, 100)),
  });
  return github<{ number: number; body: string | null }[]>(c, `/issues?${q}`);
}

/** Checks GitHub's `X-Hub-Signature-256` header against the raw body. */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
