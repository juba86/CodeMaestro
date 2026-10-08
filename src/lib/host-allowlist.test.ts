import { describe, expect, it } from "vitest";
import { configuredHosts, hostnameOf, isAllowedHostname, requestHostAllowed } from "./host-allowlist";

const noEnv: Record<string, string> = {};
const allowed = (host: string, xfh: string | null = null, env = noEnv, machine = "devbox") => requestHostAllowed(host, xfh, env, machine);

describe("hostnameOf", () => {
  it("strips port, brackets, zone and the FQDN dot; lower-cases", () => {
    expect(hostnameOf("Devbox.Tail1234.TS.net:443")).toBe("devbox.tail1234.ts.net");
    expect(hostnameOf("127.0.0.1:3000")).toBe("127.0.0.1");
    expect(hostnameOf("[::1]:3000")).toBe("::1");
    expect(hostnameOf("[fe80::1%25eth0]")).toBe("fe80::1");
    expect(hostnameOf("localhost.")).toBe("localhost");
  });

  it("rejects malformed values", () => {
    for (const v of ["", " ", "[::1", "[::1]x", "host:port", "a b", "evil.example/x", "[127.0.0.1]", "a..b"]) {
      expect(hostnameOf(v), v).toBeNull();
    }
  });
});

describe("isAllowedHostname", () => {
  it("accepts loopback, private, CGNAT and link-local IPs", () => {
    for (const ip of ["127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.178.20", "100.64.0.1", "100.101.102.103", "::1", "fd7a:115c:a1e0::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isAllowedHostname(ip), ip).toBe(true);
    }
  });

  it("rejects public IPs", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "0.0.0.0"]) {
      expect(isAllowedHostname(ip), ip).toBe(false);
    }
  });

  it("accepts single-label names, *.ts.net, *.local and the machine name", () => {
    expect(isAllowedHostname("localhost")).toBe(true);
    expect(isAllowedHostname("devbox")).toBe(true);
    expect(isAllowedHostname("devbox.tail1234.ts.net")).toBe(true);
    expect(isAllowedHostname("devbox.local")).toBe(true);
    expect(isAllowedHostname("devbox.fritz.box", [], "devbox.fritz.box")).toBe(true);
  });

  it("rejects other domains — e.g. a DNS-rebinding name — and look-alikes", () => {
    for (const name of ["evil.example", "127.0.0.1.nip.io", "ts.net.evil.example", "evilts.net", "localhost.evil.example", "devbox.fritz.box"]) {
      expect(isAllowedHostname(name, [], "devbox"), name).toBe(false);
    }
  });

  it("honours exact and wildcard extras", () => {
    const extra = ["codemaestro.example.com", "*.lan.example.org", "203.0.113.7"];
    expect(isAllowedHostname("codemaestro.example.com", extra)).toBe(true);
    expect(isAllowedHostname("a.b.lan.example.org", extra)).toBe(true);
    expect(isAllowedHostname("203.0.113.7", extra)).toBe(true);
    expect(isAllowedHostname("lan.example.org", extra)).toBe(false); // wildcard = subdomains only
    expect(isAllowedHostname("www.codemaestro.example.com", extra)).toBe(false);
    expect(isAllowedHostname("evillan.example.org", extra)).toBe(false);
  });
});

describe("configuredHosts", () => {
  it("parses CODEMAESTRO_ALLOWED_HOSTS and the hosts of trusted URLs", () => {
    const env = {
      CODEMAESTRO_ALLOWED_HOSTS: " CodeMaestro.Example.com:8443 , *.lan.example.org, *, bad host ,",
      CODEMAESTRO_ALLOWED_ORIGINS: "https://proxy.example.net, not a url",
      CODEMAESTRO_INTERNAL_URL: "http://hook.example.net:3000",
    };
    expect(configuredHosts(env)).toEqual(["codemaestro.example.com", "*.lan.example.org", "proxy.example.net", "hook.example.net"]);
    expect(configuredHosts(noEnv)).toEqual([]);
  });
});

describe("requestHostAllowed", () => {
  it("rejects a DNS-rebinding request, even when it forges X-Forwarded-Host", () => {
    expect(allowed("evil.example:3000")).toBe(false);
    expect(allowed("evil.example:3000", "localhost")).toBe(false);
  });

  it("accepts the approval hook and local admin on loopback", () => {
    expect(allowed("127.0.0.1:3000")).toBe(true);
    expect(allowed("localhost:3000", "localhost:3000")).toBe(true);
    expect(allowed("[::1]:3000")).toBe(true);
  });

  it("accepts the browser behind tailscale serve (Host kept or rewritten)", () => {
    expect(allowed("devbox.tail1234.ts.net", "devbox.tail1234.ts.net")).toBe(true);
    expect(allowed("127.0.0.1:3000", "devbox.tail1234.ts.net")).toBe(true);
    expect(allowed("100.101.102.103:3000")).toBe(true);
  });

  it("checks every forwarded host and fails closed without Host", () => {
    expect(allowed("127.0.0.1:3000", "devbox.tail1234.ts.net, evil.example")).toBe(false);
    expect(requestHostAllowed(null, "localhost", noEnv, "devbox")).toBe(false);
    expect(requestHostAllowed("  ", null, noEnv, "devbox")).toBe(false);
  });

  it("accepts configured names", () => {
    const env = { CODEMAESTRO_ALLOWED_HOSTS: "codemaestro.example.com" };
    expect(allowed("codemaestro.example.com", null, env)).toBe(true);
    expect(allowed("codemaestro.example.com", null)).toBe(false);
    expect(allowed("devbox.fritz.box", null, noEnv, "devbox.fritz.box")).toBe(true);
  });
});
