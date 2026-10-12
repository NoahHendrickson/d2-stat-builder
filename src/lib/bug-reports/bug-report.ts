// What the "Report a bug" form sends, and the server's check of it. Shared by the
// dialog (for its length limits) and /api/bug-reports.

export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_PATH_LENGTH = 300;
const MAX_SHORT_FIELD_LENGTH = 40;

/** Filled in by the browser so a report can be reproduced; the server adds the rest. */
export interface BugReportContext {
  /** The page the report was sent from: pathname only (queries can carry share tokens). */
  path: string;
  /** Window size in CSS px and device pixel ratio, e.g. "1440×900 @2x". */
  viewport: string;
  /** Settings → Theme (`data-app-theme`), when one is set. */
  theme: string;
}

export interface BugReportInput {
  title: string;
  description: string;
  context: BugReportContext;
  /** A field people never see; a bot that fills it gets a quiet success and no report. */
  website: string;
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** A well-formed report, or null. Title and description are required; context is best effort. */
export function decodeBugReport(body: unknown): BugReportInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.title !== "string" || typeof b.description !== "string") return null;
  const title = b.title.trim().replace(/\s+/g, " ");
  const description = b.description.trim();
  if (!title || !description) return null;
  if (title.length > MAX_TITLE_LENGTH || description.length > MAX_DESCRIPTION_LENGTH) return null;
  const c = (b.context && typeof b.context === "object" ? b.context : {}) as Record<string, unknown>;
  const path = text(c.path, MAX_PATH_LENGTH);
  return {
    title,
    description,
    context: {
      path: path.startsWith("/") ? path : "",
      viewport: text(c.viewport, MAX_SHORT_FIELD_LENGTH),
      theme: text(c.theme, MAX_SHORT_FIELD_LENGTH),
    },
    website: text(b.website, MAX_SHORT_FIELD_LENGTH),
  };
}

/** The browser's half of the context, read when the report is sent. */
export function readBugReportContext(): BugReportContext {
  const ratio = Math.round(window.devicePixelRatio * 100) / 100;
  return {
    path: window.location.pathname,
    viewport: `${window.innerWidth}×${window.innerHeight} @${ratio}x`,
    theme: document.documentElement.dataset.appTheme ?? "",
  };
}
