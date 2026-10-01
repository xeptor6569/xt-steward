import path from "node:path";

/** Shared constants for the E2E stack (web + API + worker + node daemon). */

export const WEB_PORT = 3970;
export const API_PORT = 3971;

export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

export const E2E_DATABASE_URL =
  process.env.STEWARD_E2E_DATABASE_URL ??
  "postgres://steward:steward@localhost:5432/steward_xt_e2e";
export const E2E_REDIS_URL = process.env.STEWARD_E2E_REDIS_URL ?? "redis://localhost:6379/8";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");

export const ADMIN = {
  displayName: "E2E Admin",
  email: "e2e-admin@steward.test",
  password: "e2e-admin-password-1",
};
