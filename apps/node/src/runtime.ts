import { createLogger, createRedactor, type Logger } from "@steward/shared";
import { validateConfig, type NodeConfig, type ValidatedConfig } from "./config.js";
import { NodeConnection } from "./connection.js";
import type { NodeCredentials } from "./credentials.js";
import { RunManager } from "./runner.js";

export interface NodeRuntimeOptions {
  config: NodeConfig;
  credentials: NodeCredentials;
  logger?: Logger;
}

/**
 * Wires config, run manager, and control-plane connection together. Exposed
 * as a library so the CLI, the simulated development node, and integration
 * tests share the exact same runtime.
 */
export class NodeRuntime {
  readonly log: Logger;
  private connection?: NodeConnection;
  private runner?: RunManager;
  private validated?: ValidatedConfig;

  constructor(private readonly options: NodeRuntimeOptions) {
    this.log =
      options.logger ?? createLogger({ service: "steward-node", level: options.config.logLevel });
  }

  get connected(): boolean {
    return this.connection?.connected ?? false;
  }

  async start(): Promise<void> {
    const validated = await validateConfig(this.options.config);
    for (const problem of validated.workspaceErrors) {
      this.log.error(
        { workspaceKey: problem.key, error: problem.error },
        "workspace failed validation and will not be advertised",
      );
    }
    if (validated.workspaces.length === 0 && this.options.config.workspaces.length > 0) {
      throw new Error("no configured workspace passed validation; refusing to start");
    }
    this.validated = validated;

    // The node credential and operator-configured secrets are redacted from
    // every outgoing event and error message.
    const redact = createRedactor([
      this.options.credentials.credential,
      ...this.options.config.redactValues,
    ]);

    this.runner = new RunManager(
      validated,
      this.options.config.nodeName,
      this.options.config.maxConcurrentRuns,
      redact,
      (message) => this.connection?.send(message),
      this.log.child({ component: "runner" }),
    );

    this.connection = new NodeConnection(
      this.options.credentials.credential,
      validated,
      {
        onDispatch: (payload) => this.runner?.handleDispatch(payload),
        onCancel: (payload) => this.runner?.handleCancel(payload),
        activeRunIds: () => this.runner?.activeRunIds() ?? [],
      },
      this.log.child({ component: "connection" }),
    );
    this.connection.start();
  }

  async stop(): Promise<void> {
    this.runner?.cancelAll("cancelled");
    this.connection?.stop();
  }

  validatedConfig(): ValidatedConfig | undefined {
    return this.validated;
  }
}
