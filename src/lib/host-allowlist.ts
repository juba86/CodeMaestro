// Host allowlist for every /api request — the defence against DNS rebinding.
//
// A page on evil.example can re-resolve its own name to 127.0.0.1 (or to this
// machine's LAN/tailnet IP) after it has loaded. From then on the browser treats
// requests to CodeMaestro as SAME-origin: Origin, Sec-Fetch-Site and Host all
// say "evil.example", so the CSRF guard in src/proxy.ts waves them through, and
// the page can read the responses as well. The one thing the attacker cannot
// choose is a Host the browser did not resolve through their DNS, so only names
// a third party cannot point at this server are accepted:
//
//   - loopback, private and CGNAT/tailnet IP literals (127/8, 10/8, 172.16/12,
//     192.168/16, 100.64/10, ::1, fc00::/7, fe80::/10),
//   - single-label names (localhost, MagicDNS short names, LAN host names),
//   - *.ts.net (Tailscale MagicDNS/HTTPS) and *.local (mDNS),
//   - this machine's os.hostname(),
//   - CODEMAESTRO_ALLOWED_HOSTS (comma list, "*.example.com" = any subdomain),
//     plus the hosts of CODEMAESTRO_ALLOWED_ORIGINS and CODEMAESTRO_INTERNAL_URL
//     (both already name hosts the admin trusts).
//
// Both Host and X-Forwarded-Host must pass. `tailscale serve` overwrites
// X-Forwarded-Host with the name the browser used, but without such a proxy the
// header comes from the client — and a rebinding page is same-origin, so it may
// set "X-Forwarded-Host: localhost" without a CORS preflight (Next.js keeps a
// client-supplied value). Checking only that header would reopen the hole.

import os from "node:os";
import { BlockList, isIP } from "node:net";

const PRIVATE_IPS = new BlockList();
PRIVATE_IPS.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_IPS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_IPS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_IPS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_IPS.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT, Tailscale's 100.x addresses
PRIVATE_IPS.addAddress("::1", "ipv6");
PRIVATE_IPS.addSubnet("fc00::", 7, "ipv6"); // ULA, Tailscale's fd7a:115c:a1e0::/48
PRIVATE_IPS.addSubnet("fe80::", 10, "ipv6"); // link-local
// (BlockList also matches IPv4-mapped IPv6 such as ::ffff:127.0.0.1.)

type Env = Readonly<Record<string, string | undefined>>;

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
const TRUSTED_SUFFIXES = [".ts.net", ".local"];

function isHostname(name: string): boolean {
  return name.length > 0 && name.length <= 253 && name.split(".").every((l) => LABEL.test(l));
}

/**
 * The bare host name of a Host / X-Forwarded-Host value: lower-cased, without
 * port, IPv6 brackets, zone id or the trailing dot of a fully-qualified name.
 * null when the value is not a well-formed host.
 */
export function hostnameOf(value: string): string | null {
  let h = value.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0 || !/^(?::\d{1,5})?$/.test(h.slice(end + 1))) return null;
    const ip = h.slice(1, end).split("%")[0];
    return isIP(ip) === 6 ? ip : null;
  }
  // A bare IPv6 address is not a valid Host, but proxies may forward one.
  if (isIP(h.split("%")[0]) === 6) return h.split("%")[0];
  const colon = h.lastIndexOf(":");
  if (colon >= 0) {
    if (!/^\d{1,5}$/.test(h.slice(colon + 1))) return null;
    h = h.slice(0, colon);
  }
  if (h.endsWith(".")) h = h.slice(0, -1);
  return isIP(h) === 4 || isHostname(h) ? h : null;
}

/**
 * Extra allowed hosts from the environment, normalized: CODEMAESTRO_ALLOWED_HOSTS
 * (exact names or "*.domain" wildcards; a bare "*" is ignored on purpose) and the
 * hosts of CODEMAESTRO_ALLOWED_ORIGINS / CODEMAESTRO_INTERNAL_URL.
 */
export function configuredHosts(env: Env = process.env): string[] {
  const out: string[] = [];
  for (const raw of (env.CODEMAESTRO_ALLOWED_HOSTS ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const wildcard = entry.startsWith("*.");
    const host = hostnameOf(wildcard ? entry.slice(2) : entry);
    if (host) out.push(wildcard ? `*.${host}` : host);
  }
  for (const raw of [...(env.CODEMAESTRO_ALLOWED_ORIGINS ?? "").split(","), env.CODEMAESTRO_INTERNAL_URL ?? ""]) {
    if (!raw.trim()) continue;
    try {
      const host = hostnameOf(new URL(raw.trim()).host);
      if (host) out.push(host);
    } catch {
      /* not a URL — ignore */
    }
  }
  return out;
}

/** True when `name` (as returned by hostnameOf) cannot be a rebinding attacker's name. */
export function isAllowedHostname(name: string, extra: readonly string[] = [], machine = ""): boolean {
  const family = isIP(name);
  if (family) {
    if (PRIVATE_IPS.check(name, family === 6 ? "ipv6" : "ipv4")) return true;
  } else {
    if (!name.includes(".")) return true; // localhost, MagicDNS short name, LAN host
    if (TRUSTED_SUFFIXES.some((s) => name.endsWith(s))) return true;
    if (machine && name === machine) return true;
  }
  return extra.some((p) => (p.startsWith("*.") ? name.endsWith(p.slice(1)) : name === p));
}

/**
 * Checks the Host header and every X-Forwarded-Host value of a request. A
 * missing Host fails (HTTP/1.1 requires it; fail closed).
 */
export function requestHostAllowed(
  host: string | null,
  forwardedHost: string | null,
  env: Env = process.env,
  machine: string = os.hostname()
): boolean {
  if (!host?.trim()) return false;
  const values = [host, ...(forwardedHost ?? "").split(",")].map((v) => v.trim()).filter(Boolean);
  const extra = configuredHosts(env);
  const self = machine.trim().toLowerCase().replace(/\.$/, "");
  return values.every((v) => {
    const name = hostnameOf(v);
    return name !== null && isAllowedHostname(name, extra, self);
  });
}
