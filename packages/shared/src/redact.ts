export const REDACTED_PLACEHOLDER = "[REDACTED]";

export type Redactor = (input: string) => string;

/**
 * Builds a function that replaces every occurrence of the given secret values
 * with a placeholder. Values shorter than 4 characters are ignored to avoid
 * degenerate redaction (e.g. redacting the letter "a" everywhere).
 */
export function createRedactor(secretValues: readonly string[]): Redactor {
  const values = [...new Set(secretValues.filter((v) => v.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  if (values.length === 0) return (input) => input;
  const pattern = new RegExp(values.map(escapeRegExp).join("|"), "g");
  return (input: string) => input.replace(pattern, REDACTED_PLACEHOLDER);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Truncates a string to a maximum byte length (UTF-8), appending a marker when
 * truncation occurred. Used to enforce per-event log size limits.
 */
export function truncateUtf8(
  input: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(input, "utf8");
  if (buf.length <= maxBytes) return { text: input, truncated: false };
  let end = maxBytes;
  // Do not split a multi-byte UTF-8 sequence.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
  return { text: `${buf.subarray(0, end).toString("utf8")}… [truncated]`, truncated: true };
}
