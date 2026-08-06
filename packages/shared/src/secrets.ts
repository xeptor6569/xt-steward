import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export const TOKEN_PREFIXES = {
  enrollment: "stx_enroll_",
  nodeCredential: "stx_node_",
  session: "stx_sess_",
} as const;

export type TokenKind = keyof typeof TOKEN_PREFIXES;

/**
 * Generates a bearer secret with 256 bits of entropy from the CSPRNG.
 * The plaintext is shown/transmitted once; only its SHA-256 hash is stored.
 */
export function generateSecretToken(kind: TokenKind): string {
  return `${TOKEN_PREFIXES[kind]}${randomBytes(32).toString("base64url")}`;
}

/**
 * Hashes a high-entropy bearer secret for at-rest storage. SHA-256 without a
 * work factor is appropriate here because these secrets are 256-bit random
 * values, not human-chosen passwords.
 */
export function hashSecretToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hex-encoded hashes. */
export function secretHashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

/**
 * Hashes a human-chosen password with scrypt (memory-hard KDF from node:crypto,
 * avoiding native build dependencies). Format: scrypt$N$r$p$salt$derivedKey.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, keyB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(saltB64 ?? "", "base64");
  const expected = Buffer.from(keyB64 ?? "", "base64");
  if (expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
  } catch {
    return false;
  }
  return timingSafeEqual(derived, expected);
}
