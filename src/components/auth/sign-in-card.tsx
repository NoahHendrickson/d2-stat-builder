"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth/use-session";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{authed ? "You're signed in" : "Get started"}</CardTitle>
        <CardDescription>
          {authed
            ? `Signed in as ${data?.user?.displayName ?? "your Bungie account"}.`
            : "Sign in with your Bungie account to load your Guardians' gear."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {authed ? (
          <Button
            render={<a href="/api/auth/logout" />}
            variant="outline"
            size="lg"
            className="w-full"
          >
            Sign out
          </Button>
        ) : (
          <Button render={<a href="/api/auth/login" />} size="lg" className="w-full">
            {isLoading ? "Loading…" : "Sign in with Bungie"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
