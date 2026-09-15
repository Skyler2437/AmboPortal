import "./globals.css";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export const metadata = {
  title: "AmboPortal",
  description: "Ambassador service tracking",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    statusBarStyle: "default",
    title: "Ambo",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className="antialiased">
        <ServiceWorkerRegister />
        <Toaster
          position="top-right"
          toastOptions={{
            style: { fontFamily: "var(--font-sans)" },
          }}
          richColors
          closeButton
        />
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
