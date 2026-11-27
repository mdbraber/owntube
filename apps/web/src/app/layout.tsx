import { createServerSideHelpers } from "@trpc/react-query/server";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import superjson from "superjson";
import { Providers } from "@/app/providers";
import { UserNav } from "@/components/auth/user-nav";
import { NativeAppBridge } from "@/components/native-app/native-app-bridge";
import { SwRegister } from "@/components/pwa/sw-register";
import { FaviconInitScript } from "@/components/settings/favicon-init-script";
import { AppShell } from "@/components/shell/app-shell";
import { MobileAccountMenu } from "@/components/shell/mobile-account-menu";
import { UiScale } from "@/components/shell/ui-scale";
import { FAVICON_VERSION } from "@/lib/favicon";
import { isNativeAppUserAgent } from "@/lib/native-app";
import { auth } from "@/server/auth";
import { createTRPCContext } from "@/server/trpc/context";
import { appRouter } from "@/server/trpc/root";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  // Mono is only used for occasional UI (tags, counts, timestamps), rarely
  // above the fold — don't waste an eager preload on every page load (that's the
  // "preloaded but not used" warning). It still loads on demand when mono
  // text renders. Inter (the primary face) keeps its default preload.
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "owntube",
    template: "%s · owntube",
  },
  description: "A self-hosted, private YouTube front end",
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
  // Inside the iOS app, which draws the navigation natively. Known from the
  // request, so the web chrome is left out of the first render, not hidden
  // after hydration.
  const nativeApp = isNativeAppUserAgent((await headers()).get("user-agent"));

  // Hydrate the app-shell queries once, app-wide, so the sidebar subscriptions
  // and settings don't re-fetch on every page load (they fired on every route
  // otherwise). Both are cheap local DB reads. `refreshRecency` stays a
  // client-side background mutation.
  const helpers = createServerSideHelpers({
    router: appRouter,
    ctx: await createTRPCContext(),
    transformer: superjson,
  });
  if (isLoggedIn) {
    await Promise.allSettled([
      helpers.settings.get.prefetch(),
      helpers.subscriptions.listSidebar.prefetch({ limit: 24 }),
    ]);
  }
  const dehydratedState = helpers.dehydrate();

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-native-app={nativeApp ? "" : undefined}
    >
      <head>
        <FaviconInitScript />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers dehydratedState={dehydratedState}>
          <UiScale />
          {/* WKWebView only allows service workers for app-bound domains. */}
          {nativeApp ? <NativeAppBridge /> : <SwRegister />}
          <AppShell
            isLoggedIn={isLoggedIn}
            nativeApp={nativeApp}
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
