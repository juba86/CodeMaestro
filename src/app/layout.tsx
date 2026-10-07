import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { PwaRegister } from "@/components/pwa-register";
import { Toaster } from "sonner";

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
  themeColor: "#111113",
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
    <html lang="de" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
        <Toaster richColors position="bottom-right" />
        <PwaRegister />
      </body>
    </html>
  );
}
