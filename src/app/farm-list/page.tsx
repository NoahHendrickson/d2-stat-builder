import type { Metadata } from "next";
import { FarmListPage } from "@/components/farm-list/farm-list-page";

export const metadata = {
  title: "Farm list",
  description: "The weapon rolls you're hunting, and the drops that matched them.",
} satisfies Metadata;

export default function FarmList() {
  return <FarmListPage />;
}
