import type { Metadata } from "next";
import { ManagerPageShell } from "@/components/manager/manager-page-shell";

export const metadata = {
  title: "Items",
  description: "Your characters, vault, and postmaster in one place.",
} satisfies Metadata;

export default function ManagerPage() {
  return <ManagerPageShell />;
}
