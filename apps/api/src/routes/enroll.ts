import { nodeEnrollmentTokens, nodes } from "@steward/database";
import { AppError, generateSecretToken, hashSecretToken, newId } from "@steward/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { recordAudit } from "../lib/audit.js";
import { errorResponseSchema } from "../lib/dtos.js";

export function registerEnrollRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/nodes/enroll",
    {
      schema: {
        tags: ["nodes"],
        summary: "Exchange a one-time enrollment token for a node credential",
        description:
          "Called by the steward-node daemon. The token is burned atomically " +
          "(single-use); the returned credential is shown once and stored hashed.",
        body: z.object({
          token: z.string().startsWith("stx_enroll_").max(256),
          name: z
            .string()
            .min(1)
            .max(120)
            .regex(/^[a-z0-9][a-z0-9._-]*$/i, "node name must be alphanumeric with . _ -"),
          version: z.string().max(64).optional(),
          os: z
            .object({
              platform: z.string().max(64),
              release: z.string().max(128),
              arch: z.string().max(32),
            })
            .optional(),
          labels: z.record(z.string().max(64), z.string().max(256)).optional(),
        }),
        response: {
          201: z.object({
            nodeId: z.string(),
            nodeName: z.string(),
            /** Plaintext node credential — transmitted exactly once. */
            credential: z.string(),
            serverTime: z.string(),
          }),
          401: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
      config: { rateLimit: { max: ctx.env.authRateLimitMax, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const tokenHash = hashSecretToken(request.body.token);
      const credential = generateSecretToken("nodeCredential");

      const created = await ctx.db.transaction(async (tx) => {
        // Atomic single-use burn: only one concurrent request can flip usedAt.
        const [burned] = await tx
          .update(nodeEnrollmentTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(nodeEnrollmentTokens.tokenHash, tokenHash),
              isNull(nodeEnrollmentTokens.usedAt),
              isNull(nodeEnrollmentTokens.revokedAt),
              gt(nodeEnrollmentTokens.expiresAt, sql`now()`),
            ),
          )
          .returning();
        if (!burned) {
          throw AppError.unauthorized("Enrollment token is invalid, expired, used, or revoked");
        }

        const [existingName] = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(eq(nodes.name, request.body.name))
          .limit(1);
        if (existingName) {
          // Rolls back the token burn so the operator can retry with a new name.
          throw AppError.conflict(
            "node_name_taken",
            `A node named "${request.body.name}" already exists`,
          );
        }

        const [node] = await tx
          .insert(nodes)
          .values({
            id: newId("node"),
            name: request.body.name,
            status: "offline",
            version: request.body.version ?? null,
            labels: request.body.labels ?? {},
            credentialHash: hashSecretToken(credential),
          })
          .returning();
        if (!node) throw new AppError("enroll_failed", "Failed to register node");
        return { node, tokenId: burned.id };
      });

      await recordAudit(ctx.db, {
        actorType: "node",
        actorId: created.node.id,
        action: "node.enrolled",
        targetType: "node",
        targetId: created.node.id,
        metadata: { enrollmentTokenId: created.tokenId, name: created.node.name },
      });

      return reply.status(201).send({
        nodeId: created.node.id,
        nodeName: created.node.name,
        credential,
        serverTime: new Date().toISOString(),
      });
    },
  );
}
