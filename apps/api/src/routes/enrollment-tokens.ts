import { nodeEnrollmentTokens } from "@steward/database";
import { AppError, generateSecretToken, hashSecretToken, newId } from "@steward/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { recordAudit } from "../lib/audit.js";
import {
  enrollmentTokenDtoSchema,
  errorResponseSchema,
  toEnrollmentTokenDto,
} from "../lib/dtos.js";
import { requireAdmin, requireCsrf, requireUser } from "../plugins/auth.js";

export function registerEnrollmentTokenRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const adminOnly = [requireCsrf(ctx), requireUser(ctx), requireAdmin()];

  r.get(
    "/node-enrollment-tokens",
    {
      schema: {
        tags: ["nodes"],
        summary: "List enrollment tokens (hashes and plaintext are never returned)",
        response: { 200: z.object({ tokens: z.array(enrollmentTokenDtoSchema) }) },
      },
      preHandler: [requireUser(ctx), requireAdmin()],
    },
    async () => {
      const rows = await ctx.db
        .select()
        .from(nodeEnrollmentTokens)
        .orderBy(desc(nodeEnrollmentTokens.createdAt))
        .limit(100);
      return { tokens: rows.map(toEnrollmentTokenDto) };
    },
  );

  r.post(
    "/node-enrollment-tokens",
    {
      schema: {
        tags: ["nodes"],
        summary: "Create a one-time node enrollment token (plaintext shown exactly once)",
        body: z.object({
          name: z.string().min(1).max(120),
          expiresInMinutes: z
            .number()
            .int()
            .min(5)
            .max(7 * 24 * 60)
            .optional(),
        }),
        response: {
          201: z.object({
            token: z.object({ ...enrollmentTokenDtoSchema.shape, plaintext: z.string() }),
          }),
        },
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      preHandler: adminOnly,
    },
    async (request, reply) => {
      const plaintext = generateSecretToken("enrollment");
      const expiresAt = new Date(
        Date.now() + (request.body.expiresInMinutes ?? ctx.env.enrollmentTokenTtlMinutes) * 60_000,
      );
      const [row] = await ctx.db
        .insert(nodeEnrollmentTokens)
        .values({
          id: newId("enrl"),
          tokenHash: hashSecretToken(plaintext),
          name: request.body.name,
          expiresAt,
          createdByUserId: request.user!.id,
        })
        .returning();
      if (!row) throw new AppError("token_create_failed", "Failed to create enrollment token");

      await recordAudit(ctx.db, {
        actorType: "user",
        actorId: request.user!.id,
        action: "node_enrollment_token.created",
        targetType: "node_enrollment_token",
        targetId: row.id,
        metadata: { name: row.name, expiresAt: expiresAt.toISOString() },
      });

      // The plaintext exists only in this response; never logged, never stored.
      return reply.status(201).send({ token: { ...toEnrollmentTokenDto(row), plaintext } });
    },
  );

  r.delete(
    "/node-enrollment-tokens/:id",
    {
      schema: {
        tags: ["nodes"],
        summary: "Revoke an enrollment token",
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), 404: errorResponseSchema },
      },
      preHandler: adminOnly,
    },
    async (request, reply) => {
      const [existing] = await ctx.db
        .select()
        .from(nodeEnrollmentTokens)
        .where(eq(nodeEnrollmentTokens.id, request.params.id))
        .limit(1);
      if (!existing) throw AppError.notFound("Enrollment token");

      if (!existing.revokedAt) {
        await ctx.db
          .update(nodeEnrollmentTokens)
          .set({ revokedAt: new Date() })
          .where(eq(nodeEnrollmentTokens.id, existing.id));
        await recordAudit(ctx.db, {
          actorType: "user",
          actorId: request.user!.id,
          action: "node_enrollment_token.revoked",
          targetType: "node_enrollment_token",
          targetId: existing.id,
        });
      }
      return reply.status(204).send(null);
    },
  );
}
