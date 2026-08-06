import { randomBytes } from "node:crypto";

export type IdPrefix =
  "usr" | "sess" | "node" | "enrl" | "ws" | "agent" | "run" | "revt" | "audit" | "msg";

/**
 * Generates a prefixed, URL-safe, collision-resistant identifier such as
 * `run_9f2c4b1a0d3e5f6a7b8c9d0e`. 16 random bytes gives 128 bits of entropy.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}
