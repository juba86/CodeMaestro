/* CodeMaestro service worker.
 *
 * Deliberately conservative: HTML is never served from cache (network-first
 * with an offline fallback), only content-hashed build assets and icons are
 * cached, and API / SSE / range requests are never intercepted — the assistant
 * streams over EventSource and must always talk to the live server. (A
 * top-level navigation to an /api URL is only handed the network response, to
 * consume the navigation preload.)
 *
 * Bump VERSION whenever this file's caching logic changes; activate() drops
 * every cache that does not belong to the current version.
 */
const VERSION = "cm-v2";
// Shell: offline page + the build assets it references + icons. Never trimmed,
// so the offline page always renders styled.
const SHELL_CACHE = `${VERSION}-shell`;
// Runtime: hashed build assets fetched while browsing. Bounded (trimCache).
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";
const ICONS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];
// Hashed chunks accumulate across rebuilds; keep the cache bounded.
const MAX_STATIC_ENTRIES = 400;

const OFFLINE_FALLBACK_HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · CodeMaestro</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111113;color:#e4e4e7;font-family:system-ui,sans-serif;padding:1rem}main{max-width:28rem;text-align:center}a{color:#a5b4fc}</style>
</head><body><main><h1>Offline</h1><p>CodeMaestro ist gerade nicht erreichbar. Läuft der Server, und bist du mit dem Tailnet verbunden?</p>
<p><a href="">Erneut versuchen</a></p></main></body></html>`;

function isImmutable(response) {
  return /\bimmutable\b/i.test(response.headers.get("Cache-Control") || "");
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_ENTRIES;
  // keys() is in insertion order — drop the oldest entries.
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function matchOwn(request) {
  for (const name of [SHELL_CACHE, STATIC_CACHE]) {
    const hit = await (await caches.open(name)).match(request);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Caches the offline page plus the build assets it references (production
 * builds only — dev chunks are not immutable), so it renders styled offline.
 */
async function precacheOfflinePage(cache) {
  const res = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
  if (!res.ok) throw new Error(`offline page: HTTP ${res.status}`);
  await cache.put(OFFLINE_URL, res.clone());
  const html = await res.text();
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  await Promise.all(
    [...assets].map(async (asset) => {
      try {
        const r = await fetch(asset);
        if (r.ok && isImmutable(r)) await cache.put(asset, r);
      } catch {
        /* best effort */
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(ICONS.map((url) => new Request(url, { cache: "reload" })));
      try {
        await precacheOfflinePage(cache);
      } catch {
        /* retried on activate; an inline fallback covers the gap */
      }
      // The legacy worker served everything cache-first forever (stale HTML →
      // dead chunk hashes). Replace it immediately instead of waiting for every
      // window to close; normal upgrades wait for the user's "Aktualisieren".
      const keys = await caches.keys();
      if (keys.some((k) => !k.startsWith("cm-"))) await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(`${VERSION}-`)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          /* unsupported */
        }
      }
      const cache = await caches.open(SHELL_CACHE);
      if (!(await cache.match(OFFLINE_URL))) {
        try {
          await precacheOfflinePage(cache);
        } catch {
          /* inline fallback */
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function offlineResponse() {
  const cached = await (await caches.open(SHELL_CACHE)).match(OFFLINE_URL);
  if (cached) return cached;
  return new Response(OFFLINE_FALLBACK_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    const res = preloaded || (await fetch(event.request));
    // `tailscale serve` answers 502 while the app itself is down.
    if (res.status === 502 || res.status === 503 || res.status === 504) return offlineResponse();
    return res;
  } catch {
    return offlineResponse();
  }
}

// Navigations the worker does not handle itself (API URLs: downloads, a JSON
// endpoint opened by hand) still have to consume the navigation preload —
// otherwise the browser sends the same request a second time.
async function passThroughNavigation(event) {
  return (await event.preloadResponse) || fetch(event.request);
}

async function cacheFirst(request, { requireImmutable }) {
  const hit = await matchOwn(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic" && (!requireImmutable || isImmutable(res))) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, res.clone());
    void trimCache(cache);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isApi = url.pathname.startsWith("/api/");

  if (req.mode === "navigate") {
    event.respondWith(isApi ? passThroughNavigation(event) : handleNavigation(event));
    return;
  }
  if (isApi) return;
  if ((req.headers.get("Accept") || "").includes("text/event-stream")) return;
  if (req.headers.has("Range")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    // Content-hashed in production (served "immutable"); dev chunks are not
    // and therefore never stored.
    event.respondWith(cacheFirst(req, { requireImmutable: true }));
    return;
  }
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, { requireImmutable: false }));
    return;
  }
  // Everything else: plain network, no caching.
});

// --- Web Push -----------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }
  // A push must always show a notification (userVisibleOnly) — never throw on
  // an unexpected payload such as `null` or a bare string.
  if (!data || typeof data !== "object") data = {};
  const title = typeof data.title === "string" && data.title ? data.title : "CodeMaestro";
  const tag = typeof data.tag === "string" && data.tag ? data.tag : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag,
      renotify: !!tag,
      data: { url: typeof data.url === "string" ? data.url : "/" },
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = new URL("/", self.location.origin);
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
    if (u.origin === self.location.origin) target = u;
  } catch {
    /* keep "/" */
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.filter((c) => new URL(c.url).origin === self.location.origin);
      // Prefer a window already on the target page (e.g. the assistant), so a
      // click does not pull another window away from what it shows.
      const client =
        same.find((c) => new URL(c.url).pathname === target.pathname) || same.find((c) => c.focused) || same[0];
      if (!client) {
        await self.clients.openWindow(target.href);
        return;
      }
      try {
        await client.focus();
      } catch {
        /* focus may be refused; still navigate */
      }
      if (client.url === target.href) return;
      try {
        await client.navigate(target.href);
      } catch {
        // Uncontrolled clients cannot be navigated by the worker — ask the page.
        client.postMessage({ type: "NAVIGATE", url: target.href });
      }
    })()
  );
});

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// The push service rotated or expired the subscription: re-subscribe and tell
// the server, so notifications keep arriving without the user re-enabling them.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        let sub = event.newSubscription;
        if (!sub) {
          const res = await fetch("/api/push/vapid", { cache: "no-store" });
          if (!res.ok) return;
          const { publicKey } = await res.json();
          sub = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (old && old.endpoint !== sub.endpoint) {
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: old.endpoint }),
          });
        }
      } catch {
        /* the toggle in the header re-syncs on the next visit */
      }
    })()
  );
});
