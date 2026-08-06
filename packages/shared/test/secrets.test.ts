import { describe, expect, it } from "vitest";
import {
  generateSecretToken,
  hashPassword,
  hashSecretToken,
  secretHashesEqual,
  verifyPassword,
} from "../src/secrets.js";

describe("generateSecretToken", () => {
  it("uses the expected prefix per kind", () => {
    expect(generateSecretToken("enrollment")).toMatch(/^stx_enroll_[A-Za-z0-9_-]{43}$/);
    expect(generateSecretToken("nodeCredential")).toMatch(/^stx_node_[A-Za-z0-9_-]{43}$/);
    expect(generateSecretToken("session")).toMatch(/^stx_sess_[A-Za-z0-9_-]{43}$/);
  });

  it("produces unique values", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSecretToken("enrollment")));
    expect(seen.size).toBe(500);
  });
});

describe("hashSecretToken", () => {
  it("is deterministic and hex-encoded", () => {
    const token = generateSecretToken("session");
    const hash = hashSecretToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecretToken(token)).toBe(hash);
  });

  it("never equals the plaintext token", () => {
    const token = generateSecretToken("enrollment");
    expect(hashSecretToken(token)).not.toContain(token);
  });
});

describe("secretHashesEqual", () => {
  it("matches equal hashes and rejects different ones", () => {
    const a = hashSecretToken("one");
    const b = hashSecretToken("two");
    expect(secretHashesEqual(a, a)).toBe(true);
    expect(secretHashesEqual(a, b)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(secretHashesEqual("", "")).toBe(false);
    expect(secretHashesEqual("abc", hashSecretToken("x"))).toBe(false);
  });
});

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("correct horse");
    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", stored)).resolves.toBe(false);
  });

  it("produces a distinct hash per call (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored values without throwing", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt$whatever")).resolves.toBe(false);
  });
});
