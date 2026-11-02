// What happens after a bug report is saved: it's filed as an issue in the feedback repo,
// then posted to the private Discord forum with a link to that issue. Each step runs when
// it's configured, and one failing leaves the other. Server-only.
import { errorText } from "@/lib/error-text";
import { createIssue, githubConfig } from "@/lib/feedback/github";
import { webReportIssue } from "@/lib/feedback/issue-format";
import { bugReportWebhookUrl, postBugReportToDiscord } from "./discord-webhook";
import type { NewBugReport } from "./neon-store";

export async function notifyBugReport(id: string, report: NewBugReport) {
  const gh = githubConfig();
  const issue = gh
    ? await createIssue(gh, webReportIssue(id, report)).catch((err) => {
        console.error("Bug report issue failed:", errorText(err));
        return null;
      })
    : null;
  const webhook = bugReportWebhookUrl();
  if (webhook) {
    await postBugReportToDiscord(webhook, id, report, issue?.html_url).catch((err) =>
      console.error("Bug report webhook failed:", errorText(err)),
    );
  }
}
