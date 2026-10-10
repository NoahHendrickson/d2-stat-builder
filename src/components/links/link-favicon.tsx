"use client";

import { useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { Globe02Icon } from "@hugeicons/core-free-icons";
import { faviconSrc } from "@/lib/links/links";
import { cn } from "@/lib/utils";

/** The site's favicon, or a globe when it has none (or the lookup fails). */
export function LinkFavicon({ url, className }: { url: string; className?: string }) {
  // Keyed by URL so editing a link to a new site retries the lookup.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (failedUrl === url) {
    return (
      <HugeiconsIcon icon={Globe02Icon}
        className={cn("text-muted-foreground size-4 shrink-0", className)}
        aria-hidden
      />
    );
  }
  return (
    <Image
      src={faviconSrc(url)}
      alt=""
      width={16}
      height={16}
      className={cn("size-4 shrink-0 rounded-none object-contain", className)}
      onError={() => setFailedUrl(url)}
      unoptimized
      aria-hidden
    />
  );
}
