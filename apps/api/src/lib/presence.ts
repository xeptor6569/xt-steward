import { nodePresenceKey } from "@steward/protocol/internal";
import type { Redis } from "ioredis";

export async function markNodePresent(redis: Redis, nodeId: string, ttlMs: number): Promise<void> {
  await redis.set(nodePresenceKey(nodeId), new Date().toISOString(), "PX", ttlMs);
}

export async function clearNodePresence(redis: Redis, nodeId: string): Promise<void> {
  await redis.del(nodePresenceKey(nodeId));
}

export async function isNodePresent(redis: Redis, nodeId: string): Promise<boolean> {
  return (await redis.exists(nodePresenceKey(nodeId))) === 1;
}
