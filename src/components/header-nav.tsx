"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { href: "/", label: "Stat Builder" },
  { href: "/armor", label: "Table" },
] as const;

/** Header tab navigation — route-based, styled with the @blank-slate Tabs component. */
export function HeaderNav() {
  const pathname = usePathname();
  const value = TABS.find((tab) => tab.href === pathname)?.href ?? "/";

  return (
    <Tabs value={value}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger
            key={tab.href}
            value={tab.href}
            nativeButton={false}
            render={(props) => <Link {...props} href={tab.href} />}
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
