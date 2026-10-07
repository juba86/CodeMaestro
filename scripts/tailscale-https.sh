#!/usr/bin/env bash
# Publishes CodeMaestro on your tailnet over HTTPS with `tailscale serve`, so it
# can be installed as a PWA from https://<machine>.<tailnet>.ts.net.
#
#   bash scripts/tailscale-https.sh [up|status|down|reset]
#
#   up      (default) proxy https://<machine>.<tailnet>.ts.net[:HTTPS_PORT] to
#           http://127.0.0.1:$PORT in the background (persists across reboots)
#   status  show the serve configuration and the app URL
#   down    remove only CodeMaestro's mapping
#   reset   remove ALL tailscale serve mappings of this machine
#
# Environment:
#   PORT                   app port (default 3000; same as `next start`)
#   TAILSCALE_HTTPS_PORT   tailnet HTTPS port (default 443)
#   TAILSCALE_SUDO=1       run tailscale via sudo (alternative: once run
#                          `sudo tailscale set --operator=$USER`)
#
# Syntax per https://tailscale.com/docs/reference/tailscale-cli/serve :
#   tailscale serve --bg --https=<port> <target>  /  tailscale serve --https=<port> off
set -euo pipefail

PORT="${PORT:-3000}"
HTTPS_PORT="${TAILSCALE_HTTPS_PORT:-443}"
TARGET="http://127.0.0.1:${PORT}"
CMD="${1:-up}"

info() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

case "$CMD" in
  -h | --help | help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

case "$PORT$HTTPS_PORT" in
  *[!0-9]*) die "PORT and TAILSCALE_HTTPS_PORT must be numeric." ;;
esac

command -v tailscale >/dev/null 2>&1 || die "tailscale CLI not found. Install it: https://tailscale.com/download"

ts() {
  if [ "${TAILSCALE_SUDO:-0}" = "1" ]; then sudo tailscale "$@"; else tailscale "$@"; fi
}

permission_hint() {
  warn "If this failed with 'access denied', either run with TAILSCALE_SUDO=1 or allow your user once:"
  warn "  sudo tailscale set --operator=\$USER"
}

# Reads BackendState, Self.DNSName (without trailing dot), MagicDNS and whether
# the control plane issues certificates for this name (CertDomains).
read_status() {
  local json
  json="$(ts status --json 2>/dev/null)" || die "tailscale is not running. Start it and log in: sudo tailscale up"
  local parsed
  if command -v node >/dev/null 2>&1; then
    parsed="$(printf '%s' "$json" | node -e '
      let s = "";
      process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const j = JSON.parse(s);
        const name = String((j.Self && j.Self.DNSName) || "").replace(/\.$/, "");
        const magic = j.CurrentTailnet ? !!j.CurrentTailnet.MagicDNSEnabled : !!name;
        const cert = Array.isArray(j.CertDomains) && j.CertDomains.includes(name);
        console.log([j.BackendState || "", name, magic ? 1 : 0, cert ? 1 : 0].join("\n"));
      });
    ')" || die "Could not parse 'tailscale status --json'."
  elif command -v jq >/dev/null 2>&1; then
    parsed="$(printf '%s' "$json" | jq -r '
      ((.Self.DNSName // "") | sub("\\.$"; "")) as $n
      | [ (.BackendState // ""), $n,
          (if (.CurrentTailnet.MagicDNSEnabled // ($n != "")) then 1 else 0 end),
          (if ((.CertDomains // []) | index($n)) then 1 else 0 end) ]
      | .[] | tostring')" || die "Could not parse 'tailscale status --json'."
  else
    die "node or jq is required to read 'tailscale status --json'."
  fi
  { read -r TS_STATE; read -r DNS_NAME; read -r MAGIC_DNS; read -r CERT_OK; } <<<"$parsed"
}

require_running() {
  read_status
  if [ "$TS_STATE" != "Running" ]; then
    die "Tailscale is not connected (state: ${TS_STATE:-unknown}). Run: sudo tailscale up"
  fi
  if [ -z "$DNS_NAME" ] || [ "$MAGIC_DNS" != "1" ]; then
    die "MagicDNS is disabled. Enable it in the admin console: https://login.tailscale.com/admin/dns"
  fi
}

app_url() {
  if [ "$HTTPS_PORT" = "443" ]; then printf 'https://%s' "$DNS_NAME"; else printf 'https://%s:%s' "$DNS_NAME" "$HTTPS_PORT"; fi
}

cmd_up() {
  require_running
  if [ "$CERT_OK" != "1" ]; then
    warn "HTTPS certificates are not enabled for this tailnet yet."
    warn "Enable them under DNS → HTTPS Certificates: https://login.tailscale.com/admin/dns"
    warn "(tailscale serve may print a link to enable them interactively.)"
  fi

  info "Proxying $(app_url) → ${TARGET}"
  if ! ts serve --bg --https="${HTTPS_PORT}" "${TARGET}"; then
    permission_hint
    die "tailscale serve failed."
  fi

  if command -v curl >/dev/null 2>&1 && ! curl -fs -o /dev/null --max-time 3 "${TARGET}/manifest.webmanifest"; then
    warn "CodeMaestro does not answer on ${TARGET} yet. Start it bound to loopback:"
    warn "  npm run build && PORT=${PORT} npm run start:tailnet"
  fi

  info ""
  info "CodeMaestro is available in your tailnet at:"
  info "  $(app_url)"
  info ""
  info "The first request may take a few seconds while the certificate is issued."
  info "The mapping persists across reboots; remove it with: npm run tailscale:down"
}

cmd_status() {
  require_running
  ts serve status || { permission_hint; exit 1; }
  info ""
  info "App URL: $(app_url)  (proxied to ${TARGET})"
  [ "$CERT_OK" = "1" ] || warn "HTTPS certificates are not enabled: https://login.tailscale.com/admin/dns"
}

cmd_down() {
  if ! ts serve --https="${HTTPS_PORT}" off; then
    permission_hint
    die "Could not remove the mapping for HTTPS port ${HTTPS_PORT} (see 'npm run tailscale:status')."
  fi
  info "Removed the tailscale serve mapping on HTTPS port ${HTTPS_PORT}."
}

cmd_reset() {
  warn "This removes ALL tailscale serve/funnel mappings of this machine."
  ts serve reset || { permission_hint; exit 1; }
  info "tailscale serve configuration cleared."
}

case "$CMD" in
  up) cmd_up ;;
  status) cmd_status ;;
  down | off) cmd_down ;;
  reset) cmd_reset ;;
  *) die "Unknown command '$CMD' (use: up | status | down | reset)" ;;
esac
