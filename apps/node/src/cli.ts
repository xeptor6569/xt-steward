import { existsSync } from "node:fs";
import { Command } from "commander";
import { createLogger, LOG_LEVELS, type LogLevel } from "@steward/shared";
import { defaultConfigPaths, loadConfigFile, validateConfig } from "./config.js";
import { defaultStateDir, loadCredentials, saveCredentials } from "./credentials.js";
import { enrollNode } from "./enroll.js";
import { NodeRuntime } from "./runtime.js";
import { STEWARD_NODE_VERSION } from "./version.js";

/* eslint-disable no-console -- the CLI's job is writing to stdout/stderr */

interface GlobalOptions {
  config?: string;
  stateDir: string;
  logLevel?: string;
}

function resolveConfigPath(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) fail(`config file not found: ${explicit}`);
    return explicit;
  }
  const fromEnv = process.env.STEWARD_NODE_CONFIG;
  if (fromEnv) {
    if (!existsSync(fromEnv)) fail(`config file not found (STEWARD_NODE_CONFIG): ${fromEnv}`);
    return fromEnv;
  }
  for (const candidate of defaultConfigPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  fail(
    `no config file found. Searched:\n  ${defaultConfigPaths().join("\n  ")}\n` +
      "Pass --config <path> or set STEWARD_NODE_CONFIG.",
  );
}

function fail(message: string): never {
  console.error(`steward-node: ${message}`);
  process.exit(1);
}

const program = new Command("steward-node")
  .description("Steward Node daemon — connects this machine to a Steward XT control plane")
  .version(STEWARD_NODE_VERSION, "-V, --version", "print the steward-node version")
  .option("-c, --config <path>", "path to the node config file (YAML)")
  .option("--state-dir <path>", "directory for credentials and local state", defaultStateDir())
  .option("--log-level <level>", `log level (${LOG_LEVELS.join(", ")})`);

program
  .command("version")
  .description("print version information")
  .option("--json", "output JSON")
  .action((options: { json?: boolean }) => {
    if (options.json) {
      console.log(JSON.stringify({ version: STEWARD_NODE_VERSION, node: process.version }));
    } else {
      console.log(`steward-node ${STEWARD_NODE_VERSION} (node ${process.version})`);
    }
  });

program
  .command("enroll")
  .description("enroll this machine with a Steward XT control plane using a one-time token")
  .requiredOption("--server <url>", "control plane URL, e.g. https://steward.example.com")
  .requiredOption("--token <token>", "one-time enrollment token (stx_enroll_...)")
  .option("--name <name>", "node name (defaults to nodeName from the config file)")
  .option("--insecure-http", "allow plain http:// for local development only", false)
  .option("--force", "overwrite existing credentials", false)
  .action(
    async (options: {
      server: string;
      token: string;
      name?: string;
      insecureHttp: boolean;
      force: boolean;
    }) => {
      const globals = program.opts<GlobalOptions>();
      const existing = loadCredentials(globals.stateDir);
      if (existing && !options.force) {
        fail(
          `this machine is already enrolled as "${existing.nodeName}" (${existing.nodeId}).\n` +
            "Pass --force to re-enroll with a new identity.",
        );
      }

      let nodeName = options.name;
      if (!nodeName) {
        const configPath = resolveConfigPath(globals.config);
        nodeName = loadConfigFile(configPath).nodeName;
      }

      try {
        const result = await enrollNode({
          serverUrl: options.server,
          token: options.token,
          nodeName,
          allowInsecureHttp: options.insecureHttp,
        });
        const file = saveCredentials(globals.stateDir, {
          nodeId: result.nodeId,
          nodeName: result.nodeName,
          serverUrl: options.server,
          credential: result.credential,
          enrolledAt: new Date().toISOString(),
        });
        console.log(`Enrolled as "${result.nodeName}" (${result.nodeId}).`);
        console.log(`Credential stored in ${file} (mode 0600). Keep this file private.`);
        console.log(`Start the daemon with: steward-node start`);
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

program
  .command("validate-config")
  .description("validate the node configuration file and workspace paths")
  .option("--json", "output JSON")
  .action(async (options: { json?: boolean }) => {
    const globals = program.opts<GlobalOptions>();
    const configPath = resolveConfigPath(globals.config);
    try {
      const config = loadConfigFile(configPath);
      const validated = await validateConfig(config);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              configPath,
              valid: validated.workspaceErrors.length === 0,
              workspaces: validated.workspaces.map((w) => ({
                key: w.key,
                canonicalPath: w.canonicalPath,
                readOnly: w.readOnly,
                repositoryUrl: w.repositoryUrl,
              })),
              errors: validated.workspaceErrors,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`Config: ${configPath}`);
        console.log(`Server: ${config.serverUrl}`);
        console.log(`Node name: ${config.nodeName}`);
        for (const w of validated.workspaces) {
          console.log(
            `  workspace ${w.key}: ok (${w.canonicalPath}${w.readOnly ? ", read-only" : ""})`,
          );
        }
        for (const e of validated.workspaceErrors) {
          console.log(`  workspace ${e.key}: INVALID — ${e.error}`);
        }
      }
      if (validated.workspaceErrors.length > 0) process.exit(1);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("status")
  .description("show enrollment and control-plane reachability status")
  .option("--json", "output JSON")
  .action(async (options: { json?: boolean }) => {
    const globals = program.opts<GlobalOptions>();
    const credentials = loadCredentials(globals.stateDir);
    let serverReachable = false;
    if (credentials) {
      try {
        const response = await fetch(new URL("/api/v1/health/live", credentials.serverUrl), {
          signal: AbortSignal.timeout(5000),
        });
        serverReachable = response.ok;
      } catch {
        serverReachable = false;
      }
    }
    const status = {
      version: STEWARD_NODE_VERSION,
      enrolled: credentials !== null,
      nodeId: credentials?.nodeId ?? null,
      nodeName: credentials?.nodeName ?? null,
      serverUrl: credentials?.serverUrl ?? null,
      serverReachable,
      stateDir: globals.stateDir,
    };
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(`steward-node ${status.version}`);
      console.log(`  enrolled:         ${status.enrolled ? "yes" : "no"}`);
      if (credentials) {
        console.log(`  node:             ${status.nodeName} (${status.nodeId})`);
        console.log(`  server:           ${status.serverUrl}`);
        console.log(`  server reachable: ${serverReachable ? "yes" : "no"}`);
      } else {
        console.log(`  Run "steward-node enroll --server <url> --token <token>" to enroll.`);
      }
    }
    if (credentials && !serverReachable) process.exit(1);
  });

program
  .command("start")
  .description("start the node daemon (outbound connection, heartbeats, run execution)")
  .action(async () => {
    const globals = program.opts<GlobalOptions>();
    const configPath = resolveConfigPath(globals.config);
    const credentials = loadCredentials(globals.stateDir);
    if (!credentials) {
      fail('not enrolled. Run "steward-node enroll --server <url> --token <token>" first.');
    }

    let config;
    try {
      config = loadConfigFile(configPath);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }

    const logLevel = (globals.logLevel ?? config.logLevel) as LogLevel;
    if (!LOG_LEVELS.includes(logLevel)) fail(`invalid log level: ${logLevel}`);
    const logger = createLogger({ service: "steward-node", level: logLevel });

    const runtime = new NodeRuntime({ config, credentials, logger });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, "shutting down");
      await runtime.stop();
      // Give in-flight cancellations a moment to reach the server.
      setTimeout(() => process.exit(0), 500).unref();
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    try {
      await runtime.start();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
