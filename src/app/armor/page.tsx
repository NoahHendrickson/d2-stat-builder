import type { Metadata } from "next";
import { ArmorTablePageShell } from "@/components/armor-table/armor-table-page-shell";

export const metadata = {
  title: "Armor",
  description: "Every armor piece you own in one sortable table, with junk marking and duplicates.",
} satisfies Metadata;

export default function ArmorTablePage() {
  return <ArmorTablePageShell />;
}
