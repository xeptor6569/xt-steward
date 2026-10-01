import { createLogger } from "@steward/shared";
import { loadWorkerEnv } from "./env.js";
import { createWorkerRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const log = createLogger({
    service: "steward-worker",
    level: env.logLevel,
    pretty: env.logPretty,
  });

  const runtime = createWorkerRuntime(env, log);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
    try {
      await runtime.stop();
      process.exit(0);
    } catch (err) {
      log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await runtime.start();
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- logger may not exist yet at boot failure
  console.error(err);
  process.exit(1);
});
