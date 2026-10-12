import type { Metadata } from "next";
import { BuilderPageShell } from "@/components/builder/builder-page-shell";
import { tabTitle } from "@/lib/site";

export const metadata = {
  // The root layout's title template only applies to child segments, so / sets its own.
  title: { absolute: tabTitle("Optimizer") },
} satisfies Metadata;

export default function Home() {
  return <BuilderPageShell />;
}
