import { users } from "@steward/database";
import { AppError, hashPassword, newId } from "@steward/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { recordAudit } from "../lib/audit.js";
import { sessionCookieName, sessionCookieOptions } from "../lib/cookies.js";
import { errorResponseSchema, toUserDto, userDtoSchema } from "../lib/dtos.js";
import { createSession } from "../lib/sessions.js";
import { requireCsrf } from "../plugins/auth.js";

async function countUsers(ctx: AppContext): Promise<number> {
  const [row] = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}

export function registerSetupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/setup/status",
    {
      schema: {
        tags: ["setup"],
        summary: "Whether initial administrator setup is still required",
        response: { 200: z.object({ needsSetup: z.boolean() }) },
      },
    },
    async () => ({ needsSetup: (await countUsers(ctx)) === 0 }),
  );

  r.post(
    "/setup",
    {
      schema: {
        tags: ["setup"],
        summary: "Create the first local administrator (only while no users exist)",
        body: z.object({
          displayName: z.string().min(1).max(120),
          email: z.email().max(320),
          password: z.string().min(12).max(512),
        }),
        response: {
          201: z.object({ user: userDtoSchema }),
          409: errorResponseSchema,
        },
      },
      config: { rateLimit: { max: ctx.env.authRateLimitMax, timeWindow: "1 minute" } },
      preHandler: [requireCsrf(ctx)],
    },
    async (request, reply) => {
      // Guarded twice: a fast check here and a serialized transaction below so
      // two concurrent setup attempts cannot both create an administrator.
      if ((await countUsers(ctx)) > 0) {
        throw AppError.conflict("setup_already_complete", "An administrator already exists");
      }

      const passwordHash = await hashPassword(request.body.password);
      const user = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`lock table ${users} in exclusive mode`);
        const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
        if ((existing?.count ?? 0) > 0) {
          throw AppError.conflict("setup_already_complete", "An administrator already exists");
        }
        const [created] = await tx
          .insert(users)
          .values({
            id: newId("usr"),
            displayName: request.body.displayName,
            email: request.body.email.toLowerCase(),
            role: "admin",
            passwordHash,
          })
          .returning();
        if (!created) throw new AppError("setup_failed", "Failed to create administrator");
        return created;
      });

      await recordAudit(ctx.db, {
        actorType: "user",
        actorId: user.id,
        action: "user.setup_admin_created",
        targetType: "user",
        targetId: user.id,
      });

      const session = await createSession(ctx.db, user.id, ctx.env.sessionTtlHours);
      reply.setCookie(
        sessionCookieName(ctx.env),
        session.token,
        sessionCookieOptions(ctx.env, session.expiresAt),
      );
      return reply.status(201).send({ user: toUserDto(user) });
    },
  );
}
