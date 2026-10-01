import { z } from "zod";

/** Zod helper: parses "true"/"1"/"false"/"0" env strings into booleans. */
export const booleanString = z
  .string()
  .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase()));

/** Zod helper: parses a base-10 integer env string. */
export const intString = z.coerce.number().int();

/**
 * Parses `process.env` (or a provided source) against a Zod schema and exits
 * with a readable message listing every invalid variable when validation
 * fails. All Steward environment variables use the `STEWARD_` prefix.
 */
export function parseEnv<T extends z.ZodRawShape>(
  shape: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<z.ZodObject<T>> {
  const result = z.object(shape).safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}
