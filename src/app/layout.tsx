import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading/loading-screen";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";
import { DEFAULT_SKIN, SKIN_BOOTSTRAP_SCRIPT } from "@/lib/skin";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
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
      // next-themes rewrites `class` and the skin bootstrap rewrites `data-skin`
      // before hydration, so the server's defaults may not match the client's.
      suppressHydrationWarning
      data-skin={DEFAULT_SKIN}
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="h-dvh antialiased">
        {/* Applies the saved skin before first paint (see src/lib/skin.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SKIN_BOOTSTRAP_SCRIPT }} />
        {/* The blurred scene every panel floats over (D2 skin only). */}
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
