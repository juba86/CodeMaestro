// Request guard for every /api route (Next.js 16 "proxy", formerly middleware).
//
// 0. Host allowlist (src/lib/host-allowlist.ts), for EVERY method: rejects
//    requests whose Host / X-Forwarded-Host is not a name this server is known
//    by. This stops DNS rebinding — a page whose own domain re-resolves to
//    127.0.0.1 is "same-origin" to the browser, passes the CSRF check below and
//    could read and drive the API (e.g. create a bypassPermissions session).
//
// 1. CSRF: state-changing requests (anything but GET/HEAD/OPTIONS) from a
//    browser must come from this app's own origin. Without this, any web page
//    the user visits could drive the server with no-cors POSTs — e.g. enable
//    the Telegram bridge with an attacker's bot, which amounts to a remote
//    shell. Non-browser clients (curl, the approval hook) send neither Origin
//    nor Sec-Fetch-Site and pass.
//
// 2. Optional identity allowlist (CODEMAESTRO_TAILSCALE_USERS): every /api
//    request must carry a Tailscale-User-Login listed there ("*" = any tailnet
//    user). `tailscale serve` deletes client-supplied Tailscale-User-* headers
//    and sets them from the WireGuard peer's identity; it also overwrites
//    X-Forwarded-For with the peer's tailnet IP. Direct loopback connections
//    (approval hook, local admin) are exempt.
//
// TRUST ASSUMPTION: the app listens on 127.0.0.1 only (`npm run start:tailnet`),
// so nothing but `tailscale serve` and local processes can reach it. If the app
// is bound to 0.0.0.0, anyone on the network can forge these headers and the
// identity check is meaningless (see docs/TAILSCALE_HTTPS.md).

import { NextResponse, type NextRequest } from "next/server";
import { requestHostAllowed } from "@/lib/host-allowlist";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function deny(status: number, code: "FORBIDDEN_HOST" | "FORBIDDEN_ORIGIN" | "FORBIDDEN_IDENTITY", error: string) {
  return NextResponse.json({ error, code }, { status });
}

function firstValue(v: string | null): string {
  return (v ?? "").split(",")[0].trim();
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** host[:port] lower-cased, with the scheme's default port removed. */
function normalizeHost(host: string, protocol: string): string {
  const h = host.trim().toLowerCase();
  if (protocol === "https:" && h.endsWith(":443")) return h.slice(0, -4);
  if (protocol === "http:" && h.endsWith(":80")) return h.slice(0, -3);
  return h;
}

function hostnameOf(host: string): string {
  const h = host.toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

function isLoopbackIp(ip: string): boolean {
  const a = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

function originAllowed(req: NextRequest, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false; // includes the opaque "null" origin
  }
  const allowed = listFromEnv("CODEMAESTRO_ALLOWED_ORIGINS").map((o) => o.replace(/\/+$/, "").toLowerCase());
  if (allowed.includes(parsed.origin.toLowerCase())) return true;

  // `tailscale serve` and Next.js both set X-Forwarded-Host to the Host the
  // browser used; fall back to Host for setups without it.
  const requestHost = firstValue(req.headers.get("x-forwarded-host")) || firstValue(req.headers.get("host"));
  if (!requestHost) return false;
  return normalizeHost(parsed.host, parsed.protocol) === normalizeHost(requestHost, parsed.protocol);
}

/** Direct loopback request (no reverse proxy hop in between). */
function isDirectLocal(req: NextRequest): boolean {
  // Next.js fills X-Forwarded-For with the socket address when absent; through
  // `tailscale serve` it holds the peer's tailnet IP (never loopback).
  const xff = req.headers.get("x-forwarded-for");
  if (xff && !xff.split(",").every((ip) => isLoopbackIp(ip))) return false;
  const host = firstValue(req.headers.get("host"));
  return LOCAL_HOSTNAMES.has(hostnameOf(host));
}

export function proxy(req: NextRequest) {
  // --- Host allowlist (DNS rebinding) ------------------------------------------
  // Applies to reads too: a rebinding page can read whatever it fetches.
  if (!requestHostAllowed(req.headers.get("host"), req.headers.get("x-forwarded-host"))) {
    return deny(
      403,
      "FORBIDDEN_HOST",
      "Unbekannter Hostname – Zugriff abgelehnt. Eigene Namen in CODEMAESTRO_ALLOWED_HOSTS eintragen."
    );
  }

  // --- CSRF -------------------------------------------------------------------
  if (!SAFE_METHODS.has(req.method.toUpperCase())) {
    const site = req.headers.get("sec-fetch-site");
    if (site === "cross-site") {
      return deny(403, "FORBIDDEN_ORIGIN", "Cross-Site-Anfrage abgelehnt.");
    }
    const origin = req.headers.get("origin");
    if (origin !== null && !originAllowed(req, origin)) {
      return deny(403, "FORBIDDEN_ORIGIN", "Anfrage von fremder Herkunft abgelehnt.");
    }
  }

  // --- Tailscale identity allowlist ------------------------------------------
  const users = listFromEnv("CODEMAESTRO_TAILSCALE_USERS").map((u) => u.toLowerCase());
  if (users.length > 0 && !isDirectLocal(req)) {
    const login = (req.headers.get("tailscale-user-login") ?? "").trim().toLowerCase();
    if (!login || !(users.includes("*") || users.includes(login))) {
      return deny(
        403,
        "FORBIDDEN_IDENTITY",
        login
          ? "Dieser Tailscale-Benutzer ist nicht freigeschaltet."
          : "Zugriff nur über tailscale serve mit Tailscale-Identität."
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
