"use client";

import { useEffect } from "react";
import { useSiteIcon } from "@/lib/site-icon";

/** Browsers keep tab icons apart from the HTTP cache: bump this when the icon art changes. */
const ICON_VERSION = 2;

/**
 * Points the tab icon at the icon picked in Settings. The <link rel="icon"> tags are
 * Next's (app/icon.svg, app/favicon.ico), so they are patched in place, and re-patched
 * if a navigation re-renders the head.
 */
export function SiteIconSync() {
  const { src } = useSiteIcon();
  const href = `${src}?v=${ICON_VERSION}`;

  useEffect(() => {
    const apply = () => {
      for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) {
        if (link.getAttribute("href") !== href) {
          link.setAttribute("href", href);
          link.setAttribute("type", "image/svg+xml");
          link.removeAttribute("sizes");
        }
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    return () => observer.disconnect();
  }, [href]);

  return null;
}
