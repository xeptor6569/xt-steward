import { createDatabase, type Database } from "@steward/database";
import {
  NODE_COMMAND_CHANNEL_PATTERN,
  nodeIdFromCommandChannel,
  QUEUE_RUN_DISPATCH,
  RUN_EVENTS_CHANNEL_PATTERN,
  runIdFromEventsChannel,
} from "@steward/protocol/internal";
import type { Logger } from "@steward/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { ApiEnv } from "./env.js";

type ChannelListener = (channel: string, message: string) => void;

/**
 * One shared Redis pattern subscriber per API process. The gateway listens on
 * per-node command channels; SSE connections listen on per-run event
 * channels. Listeners register here instead of opening their own
 * connections.
 */
export class RedisFanout {
  private readonly nodeCommandListeners = new Set<ChannelListener>();
  private readonly runEventListeners = new Map<string, Set<(message: string) => void>>();

  constructor(private readonly sub: Redis) {}

  async start(): Promise<void> {
    await this.sub.psubscribe(NODE_COMMAND_CHANNEL_PATTERN, RUN_EVENTS_CHANNEL_PATTERN);
    this.sub.on("pmessage", (_pattern, channel, message) => {
      if (nodeIdFromCommandChannel(channel) !== null) {
        for (const listener of this.nodeCommandListeners) listener(channel, message);
        return;
      }
      const runId = runIdFromEventsChannel(channel);
      if (runId !== null) {
        const listeners = this.runEventListeners.get(runId);
        if (listeners) for (const listener of listeners) listener(message);
      }
    });
  }

  onNodeCommand(listener: ChannelListener): () => void {
    this.nodeCommandListeners.add(listener);
    return () => this.nodeCommandListeners.delete(listener);
  }

  onRunEvent(runId: string, listener: (message: string) => void): () => void {
    let set = this.runEventListeners.get(runId);
    if (!set) {
      set = new Set();
      this.runEventListeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      const listeners = this.runEventListeners.get(runId);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.runEventListeners.delete(runId);
    };
  }
}

export interface AppContext {
  env: ApiEnv;
  log: Logger;
  db: Database;
  redis: Redis;
  fanout: RedisFanout;
  runDispatchQueue: Queue;
  publish: (channel: string, message: string) => Promise<unknown>;
  close: () => Promise<void>;
}

export async function createAppContext(env: ApiEnv, log: Logger): Promise<AppContext> {
  const dbHandle = createDatabase(env.databaseUrl);
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const sub = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  const fanout = new RedisFanout(sub);
  await fanout.start();

  const runDispatchQueue = new Queue(QUEUE_RUN_DISPATCH, { connection: redis });

  return {
    env,
    log,
    db: dbHandle.db,
    redis,
    fanout,
    runDispatchQueue,
    publish: (channel, message) => redis.publish(channel, message),
    close: async () => {
      await runDispatchQueue.close();
      sub.disconnect();
      redis.disconnect();
      await dbHandle.close();
    },
  };
}
