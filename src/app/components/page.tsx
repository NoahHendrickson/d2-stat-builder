import type { Metadata } from "next";
import { ComponentPlayground } from "@/components/playground/component-playground";

export const metadata = {
  title: "Components",
  description:
    "D2 Conflux's custom components, live: tweak their props, force hover, focus and pressed states, and copy the JSX.",
} satisfies Metadata;

export default function ComponentsPage() {
  return <ComponentPlayground />;
}
