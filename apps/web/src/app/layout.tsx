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
        url: `/logo-dark.png?v=${FAVICON_VERSION}`,
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

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <FaviconInitScript />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>
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
