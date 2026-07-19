import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { UserNav } from "@/components/auth/user-nav";
import { SwRegister } from "@/components/pwa/sw-register";
import { FaviconInitScript } from "@/components/settings/favicon-init-script";
import { AppShell } from "@/components/shell/app-shell";
import { MobileAccountMenu } from "@/components/shell/mobile-account-menu";
import { UiScale } from "@/components/shell/ui-scale";
import { collectInvidiousOrigins } from "@/lib/channel-avatar-proxy";
import { FAVICON_VERSION } from "@/lib/favicon";
import { auth } from "@/server/auth";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "owntube",
    template: "%s · owntube",
  },
  description: "Self-hosted video front-end with Piped / Invidious",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: `/favicon-dark.ico?v=${FAVICON_VERSION}`, sizes: "any" }],
    apple: [
      {
        // Full-bleed, fully opaque icon: iOS fills any transparency and applies
        // its own rounded mask, so a transparent/pre-rounded icon shows an inset
        // line. This one is edge-to-edge with no alpha.
        url: `/apple-touch-icon.png?v=${FAVICON_VERSION}`,
        type: "image/png",
        sizes: "180x180",
      },
    ],
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user?.id);
  // Computed server-side from INVIDIOUS_BASE_URL and handed to the browser via
  // context so client image URLs match SSR without any client-side env var.
  const invidiousOrigins = collectInvidiousOrigins();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <FaviconInitScript />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers invidiousOrigins={invidiousOrigins}>
          <UiScale />
          <SwRegister />
          <AppShell
            isLoggedIn={isLoggedIn}
            topbarRight={<UserNav />}
            bottomNavAccount={<MobileAccountMenu />}
          >
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
