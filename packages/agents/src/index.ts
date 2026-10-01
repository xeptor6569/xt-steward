import { DiagnosticAgent } from "./diagnostic.js";
import type { AgentAdapter } from "./types.js";

export * from "./types.js";
export * from "./spawn.js";
export { DiagnosticAgent } from "./diagnostic.js";

/**
 * Registry of built-in adapters by agent type. Future adapters (Claude Code,
 * Ollama) register here; the node runtime resolves the adapter for a
 * dispatched run from the agent definition's `type`.
 */
export function createAgentRegistry(): ReadonlyMap<string, AgentAdapter> {
  const diagnostic = new DiagnosticAgent();
  return new Map<string, AgentAdapter>([[diagnostic.type, diagnostic]]);
}
