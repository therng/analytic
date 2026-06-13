import type { Metadata, Viewport } from "next";
import { azeretMono, baiJamjuree, manrope, mitr, sarabun, notoSansThai, prompt } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { UsernameSetup } from "@/components/social/UsernameSetup";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Analytic",
  description: "เวปส่องเพื่อนนักเทรดสามัญชน",
  manifest: "/manifest",
  applicationName: "Analytic",
  appleWebApp: {
    capable: true,
    title: "Analytic",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  formatDetection: {
    telephone: false,
  },
  // Basic OpenGraph fallback (Update URL when deploying)
  openGraph: {
    title: "Analytic",
    description: "เวปส่องเพื่อนนักเทรดสามัญชน",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Analytic",
    description: "เวปส่องเพื่อนนักเทรดสามัญชน",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  minimumScale: 1,
  userScalable: true,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${azeretMono.variable} ${baiJamjuree.variable} ${manrope.variable} ${sarabun.variable}  ${mitr.variable} ${notoSansThai.variable} ${prompt.variable}`}>
      <body className="antialiased text-slate-200 min-h-screen flex flex-col selection:bg-blue-500/30">
        <Providers>
          <main id="main-content" className="flex-1 flex flex-col relative w-full">
            {children}
          </main>
          <UsernameSetup />
        </Providers>
      </body>
    </html>
  );
}
