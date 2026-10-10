"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { signOut } from "@/lib/auth/sign-out";
import { Button } from "@/components/ui/button";
import { PixelDissolve } from "@/components/loading/pixel-dissolve";

/**
 * The signed-out screen: the loader's dissolving site icons over the sign-in button,
 * so signing in and the load that follows read as one sequence.
 */
export function SignInCard() {
  const { data, isLoading } = useSession();
  const queryClient = useQueryClient();
  const authed = data?.authenticated ?? false;

  // Surface the result of the OAuth round trip (callback redirects with ?auth=...).
  useEffect(() => {
    const auth = new URLSearchParams(window.location.search).get("auth");
    if (!auth) return;
    if (auth === "success") {
      toast.success("Signed in with Bungie");
      queryClient.invalidateQueries({ queryKey: ["session"] });
    } else if (auth === "error") {
      toast.error("Bungie sign-in failed. Please try again.");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [queryClient]);

  return (
    <div className="flex w-full flex-col items-center gap-8 text-center">
      <PixelDissolve className="size-36" />
      <div className="flex flex-col gap-2">
        <h1 className="d2-heading text-lg">{authed ? "You're signed in" : "D2 Conflux"}</h1>
        <p className="text-muted-foreground text-sm">
          {authed
            ? `Signed in as ${data?.user?.displayName ?? "your Bungie account"}.`
            : "Sign in with your Bungie account to load your Guardians' gear."}
        </p>
      </div>
      {authed ? (
        <Button
          variant="outline"
          size="lg"
          className="w-full max-w-xs"
          onClick={async () => {
            // Also clears the cached armory, so a shared computer keeps no gear.
            if (!(await signOut(queryClient))) {
              toast.error("Sign out failed. Please try again.");
              return;
            }
            window.location.assign("/");
          }}
        >
          Sign out
        </Button>
      ) : (
        <Button
          render={<a href="/api/auth/login" />}
          nativeButton={false}
          variant="emphatic"
          size="lg"
          className="w-full max-w-xs"
        >
          {isLoading ? "Loading…" : "Sign in with Bungie"}
        </Button>
      )}
    </div>
  );
}
