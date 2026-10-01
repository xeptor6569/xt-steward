import os from "node:os";
import {
  createNodeMessage,
  parseServerToNodeMessage,
  serializeMessage,
  type NodeToServerMessage,
  type ServerToNodeMessage,
} from "@steward/protocol";
import type { Logger } from "@steward/shared";
import WebSocket from "ws";
import type { ValidatedConfig } from "./config.js";
import { STEWARD_NODE_VERSION } from "./version.js";

const OUTBOX_LIMIT = 10_000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

export interface ConnectionCallbacks {
  onDispatch: (payload: Extract<ServerToNodeMessage, { type: "run.dispatch" }>["payload"]) => void;
  onCancel: (payload: Extract<ServerToNodeMessage, { type: "run.cancel" }>["payload"]) => void;
  activeRunIds: () => string[];
}

/**
 * Outbound WebSocket connection to the control plane. The node never listens
 * on any port. Reconnects with exponential backoff and full jitter; messages
 * produced while disconnected (run events from still-executing runs) are
 * queued and flushed after the next hello, where server-side de-duplication
 * by (runId, sourceSequence) makes redelivery safe.
 */
export class NodeConnection {
  private socket?: WebSocket;
  private stopped = false;
  private attempt = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly outbox: string[] = [];
  private helloAcknowledged = false;

  constructor(
    private readonly credential: string,
    private validated: ValidatedConfig,
    private readonly callbacks: ConnectionCallbacks,
    private readonly log: Logger,
  ) {}

  get connected(): boolean {
    return this.helloAcknowledged && this.socket?.readyState === WebSocket.OPEN;
  }

  gatewayUrl(): string {
    const url = new URL("/api/v1/node-gateway", this.validated.config.serverUrl);
    url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
    return url.toString();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    this.socket?.close(1000, "node shutting down");
  }

  /** Sends immediately when connected, otherwise queues for the next session. */
  send(message: NodeToServerMessage): void {
    const serialized = serializeMessage(message);
    if (this.socket?.readyState === WebSocket.OPEN && this.helloAcknowledged) {
      this.socket.send(serialized);
      return;
    }
    if (this.outbox.length >= OUTBOX_LIMIT) this.outbox.shift();
    this.outbox.push(serialized);
  }

  private connect(): void {
    if (this.stopped) return;
    this.helloAcknowledged = false;
    const url = this.gatewayUrl();
    this.log.info({ url, attempt: this.attempt }, "connecting to control plane");

    const socket = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.credential}` },
      handshakeTimeout: 15_000,
    });
    this.socket = socket;

    socket.on("open", () => {
      this.sendRaw(
        serializeMessage(
          createNodeMessage("node.hello", {
            nodeName: this.validated.config.nodeName,
            nodeVersion: STEWARD_NODE_VERSION,
            os: { platform: os.platform(), release: os.release(), arch: os.arch() },
            runtime: { node: process.version },
            labels: {},
            capabilities: { cpus: os.cpus().length, memoryBytes: os.totalmem() },
            maxConcurrentRuns: this.validated.config.maxConcurrentRuns,
            workspaces: this.validated.workspaces.map((w) => ({
              key: w.key,
              name: w.name,
              localPath: w.canonicalPath,
              readOnly: w.readOnly,
              repositoryUrl: w.repositoryUrl,
              defaultBranch: w.defaultBranch,
            })),
            agents: this.validated.config.agents.map((a) => ({
              key: a.key,
              type: a.type,
              name: a.name,
              version: STEWARD_NODE_VERSION,
              enabled: a.enabled,
              capabilities: {},
            })),
            activeRunIds: this.callbacks.activeRunIds(),
          }),
        ),
      );
    });

    socket.on("message", (raw: Buffer) => {
      const parsed = parseServerToNodeMessage(raw);
      if (!parsed.ok || !parsed.message) {
        this.log.warn({ error: parsed.error }, "invalid message from server");
        return;
      }
      this.handleServerMessage(parsed.message);
    });

    socket.on("close", (code, reason) => {
      this.clearHeartbeat();
      this.helloAcknowledged = false;
      if (this.stopped) return;
      this.log.warn({ code, reason: reason.toString() }, "disconnected from control plane");
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.log.warn({ err: err.message }, "websocket error");
      // 'close' follows and schedules the reconnect.
    });
  }

  private handleServerMessage(message: ServerToNodeMessage): void {
    switch (message.type) {
      case "server.hello_ok": {
        this.attempt = 0;
        this.helloAcknowledged = true;
        this.log.info(
          {
            nodeId: message.payload.nodeId,
            heartbeatIntervalMs: message.payload.heartbeatIntervalMs,
          },
          "connected to control plane",
        );
        this.startHeartbeat(message.payload.heartbeatIntervalMs);
        for (const cancel of message.payload.runsToCancel) {
          this.callbacks.onCancel({
            runId: cancel.runId,
            graceMs: cancel.graceMs,
            reason: "reconciliation",
          });
        }
        this.flushOutbox();
        break;
      }
      case "run.dispatch":
        this.callbacks.onDispatch(message.payload);
        break;
      case "run.cancel":
        this.callbacks.onCancel(message.payload);
        break;
      case "server.error":
        this.log.warn(
          { code: message.payload.code, message: message.payload.message },
          "error from control plane",
        );
        break;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send(
        createNodeMessage("node.heartbeat", { activeRunIds: this.callbacks.activeRunIds() }),
      );
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private flushOutbox(): void {
    while (this.outbox.length > 0 && this.socket?.readyState === WebSocket.OPEN) {
      const message = this.outbox.shift();
      if (message) this.socket.send(message);
    }
  }

  private sendRaw(serialized: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(serialized);
  }

  /** Exponential backoff with full jitter: delay in [0, min(cap, base * 2^n)). */
  private scheduleReconnect(): void {
    const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    const delay = Math.floor(Math.random() * cap);
    this.attempt = Math.min(this.attempt + 1, 10);
    this.log.info({ delayMs: delay }, "reconnecting after backoff");
    this.reconnectTimer = setTimeout(() => this.connect(), Math.max(delay, 250));
  }
}
