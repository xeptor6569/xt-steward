import { isAppError } from "@steward/shared";
import type { FastifyError, FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";

/**
 * Uniform structured error responses: `{ error: { code, message, details?,
 * requestId } }`. Nothing is silently swallowed: unexpected errors are logged
 * with the request ID for correlation and returned as opaque 500s.
 */
export function attachErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const requestId = request.id;

    if (isAppError(err)) {
      void reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? undefined,
          requestId,
        },
      });
      return;
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      void reply.status(400).send({
        error: {
          code: "validation_failed",
          message: "Request validation failed",
          details: err.validation.map((v) => ({
            path: v.instancePath,
            message: v.message,
          })),
          requestId,
        },
      });
      return;
    }

    if (isResponseSerializationError(err)) {
      request.log.error({ err, requestId }, "response failed schema serialization");
      void reply.status(500).send({
        error: { code: "internal_error", message: "Response serialization failed", requestId },
      });
      return;
    }

    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    if (statusCode === 429) {
      void reply.status(429).send({
        error: { code: "rate_limited", message: "Too many requests, slow down", requestId },
      });
      return;
    }

    if (statusCode >= 500) {
      request.log.error({ err, requestId }, "unhandled error");
      void reply.status(statusCode).send({
        error: { code: "internal_error", message: "Internal server error", requestId },
      });
      return;
    }

    void reply.status(statusCode).send({
      error: { code: err.code ?? "request_error", message: err.message, requestId },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: "not_found", message: `Route ${request.method} ${request.url} not found` },
    });
  });
}
