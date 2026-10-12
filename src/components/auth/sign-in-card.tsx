"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { Button } from "@/components/ui/button";
import { PixelDissolve } from "@/components/loading/pixel-dissolve";

/**
 * Surface the result of the OAuth round trip (the callback redirects with ?auth=...).
 * AppShell runs it rather than the card: after a successful sign-in the card never shows.
 */
export function useAuthResultToast() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get("auth");
    if (!auth) return;
    // A tick later: this runs in the first commit, before the toaster (a parent) has
    // subscribed to the toast manager, and a toast added then is dropped.
    const timer = setTimeout(() => {
      window.history.replaceState({}, "", window.location.pathname);
      if (auth === "success") {
        toast.success("Signed in with Bungie");
        queryClient.invalidateQueries({ queryKey: ["session"] });
      } else if (auth === "error") {
        toast.error("Bungie sign-in failed. Please try again.");
      }
    });
    return () => clearTimeout(timer);
  }, [queryClient]);
}

/**
 * The signed-out screen: the loader's dissolving site icons over the sign-in button,
 * so signing in and the load that follows read as one sequence.
 */
export function SignInCard() {
  const { isLoading } = useSession();

  return (
    <div className="flex w-full flex-col items-center gap-8 text-center">
      <PixelDissolve className="size-36" />
      <div className="flex flex-col gap-2">
        <h1 className="d2-heading text-lg">D2 Conflux</h1>
        <p className="text-muted-foreground text-sm">
          Sign in with your Bungie account to load your Guardians&rsquo; gear.
        </p>
      </div>
      <Button
        render={<a href="/api/auth/login" />}
        nativeButton={false}
        variant="emphatic"
        size="lg"
        className="w-full max-w-xs"
      >
        {isLoading ? "Loading…" : "Sign in with Bungie"}
      </Button>
    </div>
  );
}
