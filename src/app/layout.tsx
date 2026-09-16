import type { Metadata } from "next";
import { Geist, Geist_Mono, Jost } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { LoadingScreen } from "@/components/loading/loading-screen";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Display face for the small uppercase labels and the EQUIP button — the
// Figma uses Futura Medium; Jost is its open geometric stand-in.
const jost = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600"],
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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jost.variable}`}
    >
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
