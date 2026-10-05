import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading/loading-screen";
import { Providers } from "@/components/providers";
import { Analytics } from "@/components/analytics";
import { EARLY_FETCH_SCRIPT } from "@/lib/early-fetch";
import { APP_THEME_SCRIPT, DEFAULT_APP_THEME } from "@/lib/app-theme-script";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "d2-stat-builder — Destiny 2 Armor Optimizer",
  description:
    "Sign in with Bungie, set your six Armor 3.0 stat targets, set bonuses, fragments, and mods, and find which of your armor pieces to equip.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-app-theme={DEFAULT_APP_THEME}
      data-line-style="plain"
      suppressHydrationWarning
      className={geistSans.variable}
    >
      <head>
        {/* A plain inline script, not next/script: in the App Router a "beforeInteractive"
            next/script is queued on self.__next_s and run by the app bootstrap only after
            the main chunk loads. This runs during HTML parse, which is the point — it
            starts the session + profile requests before the bundle arrives
            (see early-fetch.ts). */}
        <script id="early-fetch" dangerouslySetInnerHTML={{ __html: EARLY_FETCH_SCRIPT }} />
        <script id="app-theme" dangerouslySetInnerHTML={{ __html: APP_THEME_SCRIPT }} />
        {/* Dev only: Figma's html-to-design capture script (Send to Figma). */}
        {process.env.NODE_ENV === "development" && (
          <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
        )}
      </head>
      <body className="h-dvh antialiased">
        {/* The blurred scene every panel floats over. */}
        <div className="app-backdrop" aria-hidden />
        <Providers>
          <AppShell>{children}</AppShell>
          <LoadingScreen />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
