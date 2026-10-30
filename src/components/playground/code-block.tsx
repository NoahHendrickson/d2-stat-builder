"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";

/** The JSX the playground's current args produce, with a copy button. */
export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="relative border border-foreground/8 bg-black/30 normal:rounded-[10px]">
      <pre className="d2-scroll overflow-x-auto p-4 pr-12 font-mono text-[13px] leading-relaxed text-foreground/85">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2">
        <TooltipLabel label={copied ? "Copied" : "Copy code"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy code"
            onClick={() =>
              navigator.clipboard.writeText(code).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
          </Button>
        </TooltipLabel>
      </div>
    </div>
  );
}
