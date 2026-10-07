import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeController } from "@/components/theme/theme-controller";
import { ThemeScript } from "@/components/theme/theme-script";
import { ConfirmHost } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CodeMaestro",
  applicationName: "CodeMaestro",
  description: "Conduct a fleet of AI coding agents — from anywhere",
  manifest: "/manifest.webmanifest",
  // "black" (not "black-translucent"): iOS then reserves the status bar area
  // instead of drawing the header/sidebar underneath the clock.
  appleWebApp: { capable: true, statusBarStyle: "black", title: "CodeMaestro" },
  formatDetection: { telephone: false },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables live on <html> so Tailwind's font stack (resolved on
    // html) can see them. `dark` is the default; ThemeScript corrects it
    // before first paint, hence suppressHydrationWarning.
    <html lang="de" className={cn(geistSans.variable, geistMono.variable, "dark")} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="font-sans antialiased">
        <ThemeController />
        <AppShell>{children}</AppShell>
        <Toaster />
        <ConfirmHost />
        <PwaRegister />
      </body>
    </html>
  );
}
