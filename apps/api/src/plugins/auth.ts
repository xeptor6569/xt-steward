import { randomBytes } from "node:crypto";
import { AppError } from "@steward/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AppContext } from "../context.js";
import {
  CSRF_HEADER,
  csrfCookieName,
  csrfCookieOptions,
  sessionCookieName,
} from "../lib/cookies.js";
import { getSessionUser, type UserRow } from "../lib/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

/**
 * Session + CSRF wiring.
 *
 * Sessions: HTTP-only host-scoped cookie carrying a random bearer secret;
 * only its SHA-256 hash is stored. CSRF: double-submit — a readable cookie is
 * issued to every browser and state-changing requests must echo it in the
 * `x-steward-csrf` header. SameSite=Lax provides an additional layer.
 */
export function attachAuthHooks(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request, reply) => {
    if (!request.cookies[csrfCookieName(ctx.env)]) {
      reply.setCookie(
        csrfCookieName(ctx.env),
        randomBytes(24).toString("base64url"),
        csrfCookieOptions(ctx.env),
      );
    }
  });
}

export function requireCsrf(ctx: AppContext): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    const cookieValue = request.cookies[csrfCookieName(ctx.env)];
    const headerValue = request.headers[CSRF_HEADER];
    if (!cookieValue || typeof headerValue !== "string" || headerValue !== cookieValue) {
      throw new AppError("csrf_failed", "Missing or invalid CSRF token", { statusCode: 403 });
    }
  };
}

export function requireUser(ctx: AppContext): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const token = request.cookies[sessionCookieName(ctx.env)];
    if (!token) throw AppError.unauthorized();
    const user = await getSessionUser(ctx.db, token);
    if (!user) throw AppError.unauthorized("Session is invalid or expired");
    request.user = user;
  };
}

export function requireAdmin(): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    if (request.user?.role !== "admin") {
      throw AppError.forbidden("Administrator role required");
    }
  };
}
