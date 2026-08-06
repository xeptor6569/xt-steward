import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import { MAX_WS_MESSAGE_BYTES } from "@steward/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { AppContext } from "./context.js";
import { NodeGateway } from "./gateway/index.js";
import { CSRF_HEADER } from "./lib/cookies.js";
import { attachAuthHooks } from "./plugins/auth.js";
import { attachErrorHandler } from "./plugins/error-handler.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerEnrollRoutes } from "./routes/enroll.js";
import { registerEnrollmentTokenRoutes } from "./routes/enrollment-tokens.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerNodeRoutes, registerWorkspaceRoutes } from "./routes/nodes.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSetupRoutes } from "./routes/setup.js";

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  // The cast erases the pino logger generic; pino satisfies FastifyBaseLogger
  // at runtime but widens the FastifyInstance type in a way that infects
  // every route registration signature.
  const app = Fastify({
    loggerInstance: ctx.log.child({ component: "http" }),
    trustProxy: ctx.env.trustProxy,
    requestIdHeader: "x-request-id",
    disableRequestLogging: ctx.env.nodeEnv !== "development",
    bodyLimit: 1024 * 1024,
  }) as unknown as FastifyInstance;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  attachErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    // Exactly the dashboard origin; never a wildcard with credentials.
    origin: [ctx.env.webOrigin],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["content-type", CSRF_HEADER, "last-event-id"],
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: ctx.env.rateLimitMax,
    timeWindow: "1 minute",
    redis: ctx.redis,
    nameSpace: "steward:rl:",
  });
  await app.register(websocket, {
    options: { maxPayload: MAX_WS_MESSAGE_BYTES },
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Steward XT API",
        description: "Self-hosted control plane for running AI coding agents on machines you own.",
        version: "1.0.0",
      },
      servers: [{ url: "/" }],
      tags: [
        { name: "health" },
        { name: "setup" },
        { name: "auth" },
        { name: "nodes" },
        { name: "workspaces" },
        { name: "runs" },
        { name: "node-gateway" },
      ],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  attachAuthHooks(app, ctx);

  const gateway = new NodeGateway(ctx);

  await app.register(
    async (v1) => {
      registerHealthRoutes(v1, ctx);
      registerSetupRoutes(v1, ctx);
      registerAuthRoutes(v1, ctx);
      registerEnrollmentTokenRoutes(v1, ctx);
      registerEnrollRoutes(v1, ctx);
      registerNodeRoutes(v1, ctx);
      registerWorkspaceRoutes(v1, ctx);
      registerRunRoutes(v1, ctx);
      gateway.register(v1);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
