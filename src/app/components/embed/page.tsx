import type { Metadata } from "next";
import { ComponentPlayground } from "@/components/playground/component-playground";

/**
 * /components without the app around it, for framing on the portfolio's D2 Conflux
 * page. AppShell renders it bare, and next.config.ts lets only the portfolio frame it.
 */
export const metadata = {
  title: "Components",
  robots: { index: false },
} satisfies Metadata;

export default function ComponentsEmbedPage() {
  return <ComponentPlayground embed />;
}
