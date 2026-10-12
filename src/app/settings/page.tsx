import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings/settings-page";

export const metadata = {
  title: "Settings",
  description: "Theme, site icon, and other preferences for D2 Conflux.",
} satisfies Metadata;

export default function Settings() {
  return <SettingsPage />;
}
