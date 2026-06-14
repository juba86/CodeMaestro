// Client-side storage for API keys in localStorage.
// Security note: This is obfuscation, not true security. The encryption key is
// derived from a static salt embedded in the client code, meaning anyone with
// access to the source can decrypt stored keys. This is a known limitation of
// client-side-only encryption. For production use, consider server-side key storage.
//
// IMPORTANT: Web Crypto's SubtleCrypto (crypto.subtle) is only available in
// "secure contexts" — HTTPS or http://localhost. This app is commonly served
// over plain http:// on a Tailscale IP (an insecure context), where
// crypto.subtle is undefined. In that case AES would throw and keys could
// neither be saved nor read. We therefore fall back to a base64 obfuscation
// scheme, marked with a prefix so decrypt knows which scheme was used. For a
// Tailscale-private tool whose keys never leave the user's browser, this is an
// acceptable trade-off that keeps key persistence working over http.

const SALT = "prompt-builder-v1";
const FALLBACK_PREFIX = "b64:";

function hasSubtle(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function toB64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

function fromB64(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

async function getKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(SALT), iterations: 600000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptApiKey(apiKey: string): Promise<string> {
  if (!hasSubtle()) {
    // Insecure context (http:// on a non-localhost host) — fall back to base64.
    return FALLBACK_PREFIX + toB64(apiKey);
  }
  const key = await getKey(SALT);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(apiKey)
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptApiKey(encoded: string): Promise<string> {
  // Values written by the base64 fallback are prefixed and decode without crypto.
  if (encoded.startsWith(FALLBACK_PREFIX)) {
    return fromB64(encoded.slice(FALLBACK_PREFIX.length));
  }
  if (!hasSubtle()) {
    // Stored as AES but we're now in an insecure context — cannot decrypt.
    throw new Error("crypto.subtle unavailable in this (insecure) context");
  }
  const key = await getKey(SALT);
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  return new TextDecoder().decode(decrypted);
}
