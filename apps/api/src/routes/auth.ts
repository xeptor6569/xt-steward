import { users } from "@steward/database";
import { AppError, verifyPassword } from "@steward/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { recordAudit } from "../lib/audit.js";
import { clearedCookieOptions, sessionCookieName, sessionCookieOptions } from "../lib/cookies.js";
import { errorResponseSchema, toUserDto, userDtoSchema } from "../lib/dtos.js";
import { createSession, destroySession, getSessionUser } from "../lib/sessions.js";
import { requireCsrf } from "../plugins/auth.js";

/**
 * Constant-shape login: when the email is unknown we still verify against a
 * fixed dummy hash so response timing does not reveal account existence.
 */
const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$c3Rld2FyZC1kdW1teS1zYWx0$m3v1WLb9L3S1n8o5o1sQm2XxYw4T5u6V7w8X9y0Za1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4";

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/auth/login",
    {
      schema: {
        tags: ["auth"],
        summary: "Log in with email and password",
        body: z.object({
          email: z.email().max(320),
          password: z.string().min(1).max(512),
        }),
        response: {
          200: z.object({ user: userDtoSchema }),
          401: errorResponseSchema,
        },
      },
      config: { rateLimit: { max: ctx.env.authRateLimitMax, timeWindow: "1 minute" } },
      preHandler: [requireCsrf(ctx)],
    },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();
      const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);

      const passwordOk = await verifyPassword(
        request.body.password,
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      );
      if (!user || !user.passwordHash || !passwordOk) {
        throw AppError.unauthorized("Invalid email or password");
      }

      const session = await createSession(ctx.db, user.id, ctx.env.sessionTtlHours);
      reply.setCookie(
        sessionCookieName(ctx.env),
        session.token,
        sessionCookieOptions(ctx.env, session.expiresAt),
      );
      await recordAudit(ctx.db, {
        actorType: "user",
        actorId: user.id,
        action: "auth.login",
        targetType: "user",
        targetId: user.id,
      });
      return { user: toUserDto(user) };
    },
  );

  r.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Log out and destroy the current session",
        response: { 204: z.null() },
      },
      preHandler: [requireCsrf(ctx)],
    },
    async (request, reply) => {
      const token = request.cookies[sessionCookieName(ctx.env)];
      if (token) {
        const user = await getSessionUser(ctx.db, token);
        await destroySession(ctx.db, token);
        if (user) {
          await recordAudit(ctx.db, {
            actorType: "user",
            actorId: user.id,
            action: "auth.logout",
            targetType: "user",
            targetId: user.id,
          });
        }
      }
      reply.setCookie(sessionCookieName(ctx.env), "", clearedCookieOptions(ctx.env));
      return reply.status(204).send(null);
    },
  );

  r.get(
    "/auth/session",
    {
      schema: {
        tags: ["auth"],
        summary: "Current session (user is null when unauthenticated)",
        response: { 200: z.object({ user: userDtoSchema.nullable() }) },
      },
    },
    async (request) => {
      const token = request.cookies[sessionCookieName(ctx.env)];
      if (!token) return { user: null };
      const user = await getSessionUser(ctx.db, token);
      return { user: user ? toUserDto(user) : null };
    },
  );
}
