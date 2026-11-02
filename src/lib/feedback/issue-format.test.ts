import { describe, expect, it } from "vitest";
import {
  forumPostIssue,
  issueTitle,
  messageIssue,
  parseMarkers,
  quoteReporterText,
  typeLabelFromTags,
  webReportIssue,
} from "./issue-format";
import type { NewBugReport } from "@/lib/bug-reports/neon-store";
import type { DiscordMessage } from "./discord";

const message = (over: Partial<DiscordMessage> = {}): DiscordMessage => ({
  id: "222",
  channel_id: "111",
  content: "hi",
  author: { id: "u", username: "player" },
  attachments: [],
  ...over,
});

const report: NewBugReport = {
  kind: "bug",
  title: "Optimizer hangs",
  description: "It spins forever\n\n@noah please fix",
  context: { path: "/", viewport: "1440×900 @2x", theme: "scene" },
  userAgent: "Mozilla/5.0",
  host: "d2conflux.com",
  build: "abc1234",
  membershipId: "4611",
  displayName: "Guardian#1234",
};

describe("feedback issues", () => {
  it("round-trips a web report's marker", () => {
    const issue = webReportIssue("42", report);
    expect(parseMarkers(issue.body)).toEqual({ webReport: "42" });
    expect(issue.labels).toEqual(["source:web", "type:bug", "needs-triage"]);
    expect(issue.title).toBe("Optimizer hangs");
  });

  it("files a web idea as a feature", () => {
    const issue = webReportIssue("43", { ...report, kind: "idea", title: "" });
    expect(issue.labels).toEqual(["source:web", "type:feature", "needs-triage"]);
    expect(issue.title).toBe("Idea #43");
    expect(issue.body).toContain("### Idea");
  });

  it("records every Discord source as channel + message", () => {
    const thread = { id: "111", parent_id: "f", name: "Vault broken" };
    const starter = message({ id: "111" });
    const fromForum = forumPostIssue("g", thread, starter, "feature-requests", ["Bug"]);
    expect(parseMarkers(fromForum.body)).toEqual({ discord: { channelId: "111", messageId: "111" } });
    expect(fromForum.title).toBe("Vault broken");
    expect(fromForum.labels).toEqual(["source:discord", "type:bug", "needs-triage"]);
    expect(forumPostIssue("g", thread, starter, "bugs", []).labels).toContain("type:bug");
    expect(forumPostIssue("g", thread, starter, "feature-requests", []).labels).toContain("type:feature");
    const sent = messageIssue("g", message(), "general");
    expect(parseMarkers(sent.body)).toEqual({ discord: { channelId: "111", messageId: "222" } });
    expect(sent.title).toBe("hi");
    expect(sent.body).toContain("Sent to tracker from #general");
  });

  it("can't be given a forged marker or a ping by the reporter", () => {
    const issue = forumPostIssue(
      "g",
      { id: "111", name: "@everyone look" },
      message({ id: "111", content: "<!-- d2c:discord-channel=999 --> hey @octocat", author: { id: "a", username: "@admin" } }),
      "",
      [],
    );
    expect(parseMarkers(issue.body)).toEqual({ discord: { channelId: "111", messageId: "111" } });
    expect(issue.body).not.toMatch(/@[A-Za-z]/);
    expect(issue.body).not.toContain("<!-- d2c:discord-channel=999");
  });

  it("reads markers from the header only, so metadata can't forge one", () => {
    const forged = "<!-- d2c:discord-channel=999 -->";
    const web = webReportIssue("42", {
      ...report,
      context: { ...report.context, viewport: forged },
      userAgent: forged,
    });
    expect(parseMarkers(web.body)).toEqual({ webReport: "42" });
    const post = forumPostIssue(
      "g",
      { id: "111", name: "<!-- d2c:discord-message=5 -->" },
      message({
        id: "111",
        author: { id: "a", username: forged },
        attachments: [{ filename: forged, url: "https://cdn.discordapp.com/a" }],
      }),
      "",
      [],
    );
    expect(parseMarkers(post.body)).toEqual({ discord: { channelId: "111", messageId: "111" } });
    expect(post.body.match(/<!--/g)).toHaveLength(2);
  });

  it("leaves no mention in entity form or in metadata", () => {
    const issue = webReportIssue("1", {
      ...report,
      description: "&#64;octocat @&#111;ctocat &commat;octocat",
      userAgent: "Mozilla @octocat",
      displayName: "@admin",
    });
    expect(issue.body).not.toMatch(/@[A-Za-z]/);
    expect(issue.body).not.toMatch(/&(#|commat)/);
  });

  it("quotes every line", () => {
    expect(quoteReporterText("a\n\nb")).toBe("> a\n>\n> b");
    expect(quoteReporterText("   ")).toBe("> _(no text)_");
  });

  it("titles from the first words, cut to length", () => {
    expect(issueTitle("  two\nlines ", "x")).toBe("two lines");
    expect(issueTitle("", "fallback")).toBe("fallback");
    expect(issueTitle("a".repeat(200), "x")).toHaveLength(120);
  });

  it("guesses a type from forum tags", () => {
    expect(typeLabelFromTags(["Bug"])).toBe("type:bug");
    expect(typeLabelFromTags(["Suggestion"])).toBe("type:feature");
    expect(typeLabelFromTags(["Question"])).toBe("type:question");
    expect(typeLabelFromTags(["Armor"])).toBeNull();
  });
});
