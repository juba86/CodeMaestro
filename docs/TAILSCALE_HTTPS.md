# HTTPS on your tailnet (Tailscale MagicDNS) & installing the PWA

CodeMaestro is meant to run on one machine and be used from all your devices
over [Tailscale](https://tailscale.com). Serving it over **HTTPS** at
`https://<machine>.<tailnet>.ts.net` unlocks everything a browser only allows in
a *secure context*:

- installing CodeMaestro as an app (PWA) on desktop, Android and iOS,
- the service worker (offline page, fast reloads, update prompt),
- **push notifications** when the Code Assistant needs an approval/answer or a
  task finishes while no window is open,
- proper encryption of API keys stored in the browser.

`tailscale serve` terminates TLS with a Let's Encrypt certificate for your
MagicDNS name and proxies to the app on `127.0.0.1`. Nothing is exposed to the
public internet.

---

## 1. Prerequisites (once per tailnet)

1. **Tailscale** installed and logged in on the server and on every device you
   want to use (`tailscale status` shows them).
2. **MagicDNS** enabled: [admin console → DNS](https://login.tailscale.com/admin/dns).
3. **HTTPS Certificates** enabled on the same page (*Enable HTTPS*).
   Note: certificates are recorded in public Certificate Transparency logs, so
   the machine name and tailnet name (`<machine>.<tailnet>.ts.net`) become
   publicly visible. Rename the machine first if its name is sensitive.
4. On Linux, `tailscale serve` needs root unless your user is the tailscaled
   operator. Allow your user once:
   ```bash
   sudo tailscale set --operator=$USER
   ```
   (or run the npm scripts below with `TAILSCALE_SUDO=1`).

## 2. Start CodeMaestro bound to loopback and publish it

```bash
npm run build
npm run start:tailnet     # next start -H 127.0.0.1 --keepAliveTimeout 95000 (PORT defaults to 3000)
npm run tailscale:up      # tailscale serve --bg --https=443 http://127.0.0.1:3000
```

`tailscale:up` prints the final URL, e.g. `https://devbox.tail1234.ts.net`.
The first request can take a few seconds while the certificate is issued.

Other commands:

| Command | Does |
|---|---|
| `npm run tailscale:status` | `tailscale serve status` + the app URL |
| `npm run tailscale:down` | `tailscale serve --https=443 off` (removes only CodeMaestro's mapping) |
| `bash scripts/tailscale-https.sh reset` | `tailscale serve reset` (removes **all** serve mappings) |

Use `PORT=…` for a different app port and `TAILSCALE_HTTPS_PORT=8443` to publish
on another HTTPS port (`https://<machine>.<tailnet>.ts.net:8443`).

Doing it by hand is the same two commands:

```bash
next start -H 127.0.0.1 -p 3000
tailscale serve --bg --https=443 http://127.0.0.1:3000
```

> Binding to `127.0.0.1` matters: only `tailscale serve` and local processes can
> reach the app, which is what makes the security checks below trustworthy.
> Never use `tailscale funnel` for CodeMaestro — that publishes it on the
> internet, and the app can run shell commands.

## 3. Install the app

Open `https://<machine>.<tailnet>.ts.net` on the device, then:

- **Chrome / Edge (Windows, macOS, Linux, ChromeOS):** click the install icon
  in the address bar (or menu → *Cast, save and share → Install page as app* /
  *Apps → Install CodeMaestro*). The installed window offers a title-bar toggle
  (*Window Controls Overlay*) that turns the header into the title bar.
  Right-click the app icon for shortcuts to Code Assistant, Prompt Builder and
  Bibliothek.
- **Android (Chrome):** menu ⋮ → *Install app* (or *Add to Home screen*).
- **iPhone / iPad (Safari, iOS/iPadOS 16.4+):** Share → *Add to Home Screen*,
  then always open CodeMaestro from the Home Screen icon. Web Push on iOS only
  works inside the installed app, not in a Safari tab.

## 4. Push notifications

Click the **bell** in the header (in the installed app on iOS) and allow
notifications. A toast offers *Test* to send a test notification to that
device; clicking the bell again lets you send another test or turn
notifications off for the device.

You are notified when

- the assistant asks for an approval (*Freigabe nötig*) or asks a question
  (*Rückfrage vom Assistenten*),
- a task ends (*Aufgabe abgeschlossen* / *mit Fehler beendet* / *gestoppt*),

but **only while no window is watching that session live** — runs continue on
the server when you close the app, and the notification brings you straight
back to the session. Notifications are throttled per session (15 s).

Under the hood: VAPID keys are generated once and stored in the database
(`Setting` key `push.vapid`); subscriptions live in `push.subscriptions` and are
dropped automatically when the push service reports them as expired. Payloads
are end-to-end encrypted to the browser. Only the browser vendors' push services
(FCM, Mozilla, Apple, WNS) are accepted as endpoints.

Set `CODEMAESTRO_PUSH_SUBJECT` to a real contact (`mailto:you@your-domain.tld`
or an `https://` URL). Apple rejects `localhost` contacts (403 *BadJwtToken*);
the default is the project homepage.

## 5. Updates and offline behaviour

- Pages are always loaded from the network; only content-hashed build assets
  (`/_next/static`) and icons are cached. After `npm run build` + restart, the
  next navigation loads the new version.
- When the service worker itself changes, a toast *Neue Version verfügbar →
  Aktualisieren* activates it and reloads.
- If the server (or your tailnet connection) is down, an offline page explains
  what to check. API calls and the live assistant stream are never cached.

## 6. Run it as a service (systemd)

`tailscale serve --bg` is persistent: it survives reboots and `tailscale down/up`,
so only the app needs a unit. Example `/etc/systemd/system/codemaestro.service`:

```ini
[Unit]
Description=CodeMaestro
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/CodeMaestro
Environment=NODE_ENV=production
Environment=PORT=3000
# Optional hardening, see section 7:
# Environment=CODEMAESTRO_TAILSCALE_USERS=you@example.com
# Environment=CODEMAESTRO_PUSH_SUBJECT=mailto:you@example.com
ExecStart=/usr/bin/npm run start:tailnet
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codemaestro
npm run tailscale:up      # once; the mapping persists
```

(The Code Assistant runs Claude Code / Gemini CLI as `User=`, so use the account
in which those CLIs are installed and logged in. With nvm, point `ExecStart` at
the absolute `npm` path.)

## 7. Security model

- **Network:** only tailnet devices allowed by your
  [ACLs/grants](https://tailscale.com/kb/1018/acls) can reach the serve port.
- **Host allowlist / DNS rebinding** (`src/proxy.ts` +
  `src/lib/host-allowlist.ts`, every `/api` request, reads included): a web page
  whose own domain re-resolves to `127.0.0.1` or to this machine's IP looks
  *same-origin* to the browser and would pass the CSRF check below. So the
  `Host` header — and every `X-Forwarded-Host` value, which a same-origin page
  could forge — must be a name this server is known by: `localhost`, loopback,
  private and CGNAT/tailnet IPs (`127/8`, `10/8`, `172.16/12`, `192.168/16`,
  `100.64/10`, `::1`, `fc00::/7`, `fe80::/10`), single-label names (MagicDNS
  short names), `*.ts.net`, `*.local`, the machine's `hostname`, the hosts of
  `CODEMAESTRO_ALLOWED_ORIGINS` / `CODEMAESTRO_INTERNAL_URL`, and
  `CODEMAESTRO_ALLOWED_HOSTS` (comma-separated, `*.example.com` = any
  subdomain). Anything else gets `403 {code: "FORBIDDEN_HOST"}`. The approval
  hook (`127.0.0.1`) and the browser behind `tailscale serve`
  (`<machine>.<tailnet>.ts.net`) always pass.
- **CSRF protection** (`src/proxy.ts`, all `/api` routes): state-changing
  requests from browsers must come from the app's own origin. Cross-site
  requests are rejected with `403 {code: "FORBIDDEN_ORIGIN"}`. Requests without
  `Origin`/`Sec-Fetch-Site` (curl, the approval hook) pass. Add extra trusted
  origins with `CODEMAESTRO_ALLOWED_ORIGINS`.
- **Identity allowlist (optional):** set `CODEMAESTRO_TAILSCALE_USERS` to a
  comma-separated list of Tailscale login names (`*` = any tailnet user). Every
  `/api` request must then carry a matching `Tailscale-User-Login` header,
  otherwise `403 {code: "FORBIDDEN_IDENTITY"}`.
  - `tailscale serve` removes client-supplied `Tailscale-User-*` headers and
    sets them from the authenticated WireGuard peer; it also overwrites
    `X-Forwarded-For` with the peer's tailnet IP.
  - Requests from **tagged devices** carry no identity headers (Tailscale does
    not set them for tagged nodes), so they are rejected while the allowlist is
    active.
  - Direct loopback requests (Host `localhost`/`127.0.0.1`/`[::1]` and a
    loopback client address) are exempt — that is the approval hook and local
    administration.
  - **Trust assumption:** the app listens on `127.0.0.1` (`start:tailnet`). If
    you bind it to `0.0.0.0`, anyone on your LAN can forge these headers and the
    allowlist provides no protection.
  - Find a login name with `tailscale whois <tailnet-ip>` or in the admin console.

## 8. Development over the tailnet

- `next dev` through serve: `npm run dev:tailnet` and
  `tailscale serve --bg --https=443 http://127.0.0.1:3000`.
  `next.config.ts` allows `**.ts.net`, `*.local`, tailnet/LAN IPs and this
  machine's hostname (its usual MagicDNS short name) in `allowedDevOrigins`, so
  HMR keeps working. Any other name (e.g. a renamed Tailscale machine) is
  blocked by `next dev` with *"Blocked cross-origin request … to /_next/*
  resource"* — add it to `CODEMAESTRO_DEV_ORIGINS`.
- **Dev server previews** started from the Code Assistant normally get a link
  `http://<host>:<port>`, which an HTTPS page cannot use (mixed content). With
  `CODEMAESTRO_DEV_TAILSCALE_SERVE=1` CodeMaestro also runs
  `tailscale serve --bg --https=<port> http://127.0.0.1:<port>` for each dev
  server, reports `https://<machine>.<tailnet>.ts.net:<port>` as its URL and
  runs `tailscale serve --https=<port> off` when it stops. A serve mapping on
  that port that points elsewhere is never overwritten (an identical one is
  reused, and removed with the dev server); failures are written to the dev
  server log and never block the start. A Next.js project previewed this way
  needs `allowedDevOrigins: ["**.ts.net"]` in its own config for HMR.

## 9. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CODEMAESTRO_TAILSCALE_USERS` | — (off) | Comma-separated Tailscale logins allowed to use `/api`; `*` = any tailnet user. Requires the app bound to `127.0.0.1`. |
| `CODEMAESTRO_ALLOWED_HOSTS` | — | Extra host names the API answers to (DNS-rebinding guard), comma-separated; `*.example.com` = any subdomain. Tailnet/LAN names and IPs, `*.ts.net`, `*.local` and the machine's hostname are always allowed. |
| `CODEMAESTRO_ALLOWED_ORIGINS` | — | Extra origins (e.g. `https://codemaestro.example.com`) allowed to send state-changing requests. |
| `CODEMAESTRO_PUSH_SUBJECT` | project homepage | VAPID contact, `mailto:` or `https:` (not localhost). |
| `CODEMAESTRO_DEV_TAILSCALE_SERVE` | off | `1` exposes assistant dev servers via `tailscale serve` on HTTPS. |
| `CODEMAESTRO_DEV_ORIGINS` | — | Extra hostnames `next dev` accepts HMR/dev requests from (comma-separated, wildcards like `*.example.lan`). |
| `CODEMAESTRO_INTERNAL_URL` | `http://127.0.0.1:$PORT` | Base URL the CLI approval hook calls back. Keep it on loopback. |
| `ASSISTANT_APPROVAL_TIMEOUT_SEC` | `1800` (min `30`) | How long an approval/question waits before auto-deny — also how long a push for it stays deliverable. |
| `PORT` | `3000` | App port (`next start`, the approval hook and the serve script use it). |
| `TAILSCALE_HTTPS_PORT` | `443` | HTTPS port used by `npm run tailscale:*`. |
| `TAILSCALE_SUDO` | `0` | `1` runs `tailscale` via `sudo` in the serve script. |

## 10. Troubleshooting

- **Certificate errors / first load hangs:** HTTPS certificates are not enabled
  for the tailnet, or issuance is still running. Check the admin console DNS
  page, then retry; `tailscale cert <machine>.<tailnet>.ts.net` (run in a temp
  directory — it writes the cert files there) shows the error directly. Let's Encrypt rate limits can delay re-issuing by up to ~34 hours
  after many attempts.
- **Name does not resolve on a device:** the device is not in the tailnet, or it
  ignores tailnet DNS — run `tailscale set --accept-dns=true` on it.
- **502 / offline page:** serve is up but the app is not running on
  `127.0.0.1:$PORT` (`npm run tailscale:status`, `systemctl status codemaestro`).
- **Old UI after an update / blank page:** CodeMaestro replaces the old
  cache-first service worker automatically. If a browser still shows stale
  content: DevTools → Application → Service workers → *Unregister*, or *Clear
  site data*, then reload. On iOS: remove the Home Screen app and add it again.
- **Mixed content (dev server links do not open):** enable
  `CODEMAESTRO_DEV_TAILSCALE_SERVE=1`, or open the dev server via its tailnet IP
  in a separate tab.
- **Bell is disabled:** the page is not a secure context (plain `http://` on an
  IP), the browser lacks Push, or on iOS the site is open in Safari instead of
  the installed app. A crossed-out bell after denying the permission: allow
  notifications in the browser's site settings.
- **No notifications arrive:** use *Test* first. Notifications are skipped while
  a window shows the session live. For iOS check `CODEMAESTRO_PUSH_SUBJECT`
  (server log shows `HTTP 403` from `web.push.apple.com` for bad subjects).
- **`403 FORBIDDEN_HOST`:** you reach the app by a name that is not on the host
  allowlist (e.g. your own domain behind another reverse proxy) — add it to
  `CODEMAESTRO_ALLOWED_HOSTS` and restart.
- **`403 FORBIDDEN_ORIGIN`:** you reach the app via a name the server does not
  see as its own (e.g. another reverse proxy) — add that origin to
  `CODEMAESTRO_ALLOWED_ORIGINS`.
- **`403 FORBIDDEN_IDENTITY`:** your login is not in
  `CODEMAESTRO_TAILSCALE_USERS`, the device is tagged, or the request did not
  come through `tailscale serve`.
