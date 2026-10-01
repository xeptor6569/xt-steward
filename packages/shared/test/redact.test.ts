import { describe, expect, it } from "vitest";
import { createRedactor, REDACTED_PLACEHOLDER, truncateUtf8 } from "../src/redact.js";

describe("createRedactor", () => {
  it("replaces every occurrence of configured secrets", () => {
    const redact = createRedactor(["stx_node_abc123secret"]);
    const input = "credential stx_node_abc123secret used; again: stx_node_abc123secret";
    expect(redact(input)).toBe(
      `credential ${REDACTED_PLACEHOLDER} used; again: ${REDACTED_PLACEHOLDER}`,
    );
  });

  it("handles multiple secrets including regex metacharacters", () => {
    const redact = createRedactor(["p@$$w0rd(1)", "hunter22"]);
    expect(redact("p@$$w0rd(1) and hunter22")).toBe(
      `${REDACTED_PLACEHOLDER} and ${REDACTED_PLACEHOLDER}`,
    );
  });

  it("prefers longer secrets so partial overlaps redact fully", () => {
    const redact = createRedactor(["secret", "secret-extended"]);
    expect(redact("secret-extended")).toBe(REDACTED_PLACEHOLDER);
  });

  it("ignores degenerate short values", () => {
    const redact = createRedactor(["a", ""]);
    expect(redact("a banana")).toBe("a banana");
  });

  it("is a no-op with no secrets", () => {
    expect(createRedactor([])("hello")).toBe("hello");
  });
});

describe("truncateUtf8", () => {
  it("returns short strings unchanged", () => {
    expect(truncateUtf8("hello", 100)).toEqual({ text: "hello", truncated: false });
  });

  it("truncates long strings and marks them", () => {
    const { text, truncated } = truncateUtf8("x".repeat(100), 10);
    expect(truncated).toBe(true);
    expect(text).toContain("[truncated]");
    expect(text.startsWith("x".repeat(10))).toBe(true);
  });

  it("does not split multi-byte characters", () => {
    const { text, truncated } = truncateUtf8("ééééé", 5); // each é is 2 bytes
    expect(truncated).toBe(true);
    expect(text).not.toContain("\uFFFD");
  });
});
