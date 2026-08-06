import { createLogger } from "@steward/shared";
import { buildApp } from "./app.js";
import { createAppContext } from "./context.js";
import { loadApiEnv } from "./env.js";

async function main(): Promise<void> {
  const env = loadApiEnv();
  const log = createLogger({
    service: "steward-api",
    level: env.logLevel,
    pretty: env.logPretty,
  });

  const ctx = await createAppContext(env, log);
  const app = await buildApp(ctx);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "shutting down");
    try {
      await app.close();
      await ctx.close();
      process.exit(0);
    } catch (err) {
      log.error({ err }, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: env.host, port: env.port });
  log.info({ host: env.host, port: env.port }, "Steward XT API listening");
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console -- logger may not exist yet at boot failure
  console.error(err);
  process.exit(1);
});
