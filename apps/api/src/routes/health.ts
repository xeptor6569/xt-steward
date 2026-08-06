import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/health/live",
    {
      schema: {
        tags: ["health"],
        summary: "Liveness probe",
        response: { 200: z.object({ status: z.literal("ok") }) },
      },
      config: { rateLimit: false },
    },
    async () => ({ status: "ok" as const }),
  );

  r.get(
    "/health/ready",
    {
      schema: {
        tags: ["health"],
        summary: "Readiness probe (database + Redis)",
        response: {
          200: z.object({
            status: z.literal("ok"),
            checks: z.object({ database: z.literal("ok"), redis: z.literal("ok") }),
          }),
          503: z.object({
            status: z.literal("unavailable"),
            checks: z.object({ database: z.string(), redis: z.string() }),
          }),
        },
      },
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      const checks = { database: "ok", redis: "ok" };
      try {
        await ctx.db.execute(sql`select 1`);
      } catch {
        checks.database = "unreachable";
      }
      try {
        await ctx.redis.ping();
      } catch {
        checks.redis = "unreachable";
      }
      if (checks.database !== "ok" || checks.redis !== "ok") {
        return reply.status(503).send({ status: "unavailable" as const, checks });
      }
      return { status: "ok" as const, checks: { database: "ok" as const, redis: "ok" as const } };
    },
  );
}
