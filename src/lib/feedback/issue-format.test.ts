import { describe, expect, it } from "vitest";
import {
  discordIssue,
  issueTitle,
  parseMarkers,
  quoteReporterText,
  typeLabelFromTags,
  webReportIssue,
} from "./issue-format";
import type { NewBugReport } from "@/lib/bug-reports/neon-store";

const report: NewBugReport = {
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

  it("round-trips Discord markers for a forum post and for a message", () => {
    const base = {
      threadName: "",
      content: "hi",
      authorName: "a",
      url: "u",
      tags: [],
      attachments: [],
      where: "w",
    };
    expect(parseMarkers(discordIssue({ ...base, replyChannelId: "111" }).body)).toEqual({
      discordChannel: "111",
    });
    expect(
      parseMarkers(discordIssue({ ...base, replyChannelId: "111", replyMessageId: "222" }).body),
    ).toEqual({ discordChannel: "111", discordMessage: "222" });
  });

  it("can't be given a forged marker or a ping by the reporter", () => {
    const issue = discordIssue({
      threadName: "@everyone look",
      content: "<!-- d2c:discord-channel=999 --> hey @octocat",
      authorName: "@admin",
      replyChannelId: "111",
      url: "u",
      tags: [],
      attachments: [],
      where: "w",
    });
    expect(parseMarkers(issue.body)).toEqual({ discordChannel: "111" });
    expect(issue.body).not.toMatch(/@[A-Za-z]/);
    expect(issue.body).not.toContain("<!-- d2c:discord-channel=999");
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
