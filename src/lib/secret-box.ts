import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

// Server-side encryption for secrets kept in SQLite (e.g. the GitHub token).
// AES-256-GCM with a random 96-bit IV per value. The key comes from
// CODEMAESTRO_SECRET (any string, stretched with scrypt) or, when unset, from a
// random key generated on first use and persisted at
// <cwd>/.codemaestro/secret.key (dir 0700, file 0600, git-ignored).
//
// This protects tokens in DB dumps/backups that don't include the key file; it
// does not protect against someone who can read both (same as any local app).
//
// Box format: "v1:<iv>:<tag>:<ciphertext>", each part base64url.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
// Fixed salt: the env secret is the only input; this just domain-separates it.
const SCRYPT_SALT = "codemaestro-secret-box-v1";

export function secretKeyFile(): string {
  return path.join(process.cwd(), ".codemaestro", "secret.key");
}

let cached: { source: string; key: Buffer } | null = null;

function loadOrCreateKeyFile(file: string): Buffer {
  try {
    return parseKeyFile(readFileSync(file, "utf8"), file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not ours / unsupported */ }
  const key = randomBytes(KEY_BYTES);
  try {
    // "wx": never overwrite a key another process created in the meantime —
    // that would make every secret it already encrypted unreadable.
    writeFileSync(file, key.toString("base64url") + "\n", { mode: 0o600, flag: "wx" });
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return parseKeyFile(readFileSync(file, "utf8"), file);
  }
}

function parseKeyFile(text: string, file: string): Buffer {
  const key = Buffer.from(text.trim(), "base64url");
  if (key.length !== KEY_BYTES) {
    // Don't silently replace a damaged key: it would orphan every stored secret.
    throw new Error(`Schlüsseldatei ${file} ist beschädigt (erwartet ${KEY_BYTES} Bytes).`);
  }
  return key;
}

// `create: false` (decrypting) never writes a key file: a missing key means
// every stored secret is unreadable, and a fresh key wouldn't change that.
function getKey(create: boolean): Buffer | null {
  const envSecret = process.env.CODEMAESTRO_SECRET;
  const source = envSecret ? `env:${envSecret}` : `file:${secretKeyFile()}`;
  if (cached?.source === source) return cached.key;
  let key: Buffer;
  if (envSecret) {
    key = scryptSync(envSecret, SCRYPT_SALT, KEY_BYTES);
  } else if (create) {
    key = loadOrCreateKeyFile(secretKeyFile());
  } else {
    try {
      key = parseKeyFile(readFileSync(secretKeyFile(), "utf8"), secretKeyFile());
    } catch {
      return null;
    }
  }
  cached = { source, key };
  return key;
}

/** Encrypts a UTF-8 string. Throws only if no key can be obtained. */
export function encryptSecret(plain: string): string {
  const key = getKey(true)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

/** Decrypts a box from encryptSecret. Returns null on any failure (wrong key, tampering, bad format). */
export function decryptSecret(box: string | null | undefined): string | null {
  if (!box) return null;
  try {
    const parts = box.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
    const key = getKey(false);
    if (!key) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Test hook: forget the cached key (e.g. after changing CODEMAESTRO_SECRET or cwd). */
export function resetSecretKeyCache(): void {
  cached = null;
}
