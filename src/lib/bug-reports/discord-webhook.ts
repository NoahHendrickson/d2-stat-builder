// Posts a saved bug report to Discord, so it turns up where people already are. Server-only.
//
// BUG_REPORT_WEBHOOK_URL is a webhook on a private channel. In a forum channel each
// report opens its own post (named by its title) that can be tagged and closed; a text
// channel refuses `thread_name` (code 220003), so that refusal is retried as a plain
// message.
import type { NewBugReport } from "./neon-store";

const EMBED_COLOR = 0xe2524b;
/** Discord's limit on a forum post's name. */
const MAX_THREAD_NAME = 100;
/** "Webhooks can only create threads in forum channels". */
const NOT_A_FORUM = 220003;

export const bugReportWebhookUrl = () => process.env.BUG_REPORT_WEBHOOK_URL || null;

export async function postBugReportToDiscord(webhookUrl: string, id: string, r: NewBugReport) {
  const field = (name: string, value: string, inline = true) => ({
    name,
    value: value || "—",
    inline,
  });
  const message = {
    username: "Bug report",
    // Nothing a reporter types can ping @everyone, a role, or a user.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: r.title,
        description: r.description,
        color: EMBED_COLOR,
        fields: [
          field("Page", r.context.path ? `${r.host}${r.context.path}` : r.host),
          field("Account", r.displayName ?? r.membershipId),
          field("Build", r.build),
          field("Window", [r.context.viewport, r.context.theme].filter(Boolean).join(", ")),
          field("Browser", r.userAgent.slice(0, 1000), false),
        ],
        footer: { text: `Report #${id}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const post = (body: object) =>
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const refusal = async (res: Response) => {
    if (res.ok) return null;
    const text = await res.text().catch(() => "");
    let code: unknown;
    try {
      code = (JSON.parse(text) as { code?: unknown }).code;
    } catch {}
    return { code, detail: `${res.status} ${text.slice(0, 200)}` };
  };

  let refused = await refusal(
    await post({ ...message, thread_name: r.title.slice(0, MAX_THREAD_NAME) }),
  );
  if (refused?.code === NOT_A_FORUM) refused = await refusal(await post(message));
  if (refused) throw new Error(`Discord webhook answered ${refused.detail}`);
}
