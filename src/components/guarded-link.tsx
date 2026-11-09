"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { hasUnsavedChanges, leaveOrAsk } from "@/lib/navigation/unsaved-changes";

/** A link that asks first when the screen it would leave has unsaved work. */
export function GuardedLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(e) => {
        if (!hasUnsavedChanges()) return;
        e.preventDefault();
        leaveOrAsk(() => router.push(href));
      }}
    />
  );
}
