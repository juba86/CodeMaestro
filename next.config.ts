import type { NextConfig } from "next";
import os from "node:os";

// Hosts `next dev` accepts cross-origin dev requests (HMR websocket, /_next/*)
// from. Setting this list switches Next from warning to *blocking* every other
// origin, and wildcards never match a single-label name — so the machine's own
// hostname (normally also its MagicDNS short name, http://<machine>:3000) is
// listed explicitly. CODEMAESTRO_DEV_ORIGINS adds more (comma-separated hosts).
const devOrigins = [
  "**.ts.net",
  "*.local",
  "100.*.*.*",
  "10.*.*.*",
  "172.*.*.*",
  "192.168.*.*",
  os.hostname().toLowerCase(),
  ...(process.env.CODEMAESTRO_DEV_ORIGINS ?? "").split(",").map((h) => h.trim().toLowerCase()),
].filter(Boolean);

// Applied to every response. No script-src CSP on purpose: Next.js injects
// inline bootstrap scripts, which a strict script policy would break.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `next dev` reached through the tailnet (https://<machine>.<tailnet>.ts.net
  // via `tailscale serve`, a MagicDNS short name, or a tailnet/LAN IP).
  allowedDevOrigins: devOrigins,
  // Node-only push library; load it from node_modules instead of bundling.
  serverExternalPackages: ["web-push"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must never be served stale, or fixes to it would
        // take up to 24h (browser SW update cap) to reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
