import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfigFile, validateConfig } from "../src/config.js";

let dir: string;
let workspaceDir: string;

function writeConfig(contents: string): string {
  const file = path.join(dir, `config-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(file, contents);
  return file;
}

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "steward-config-"));
  workspaceDir = path.join(dir, "project");
  mkdirSync(workspaceDir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const validYaml = (extra = "") => `
serverUrl: https://steward.example.com
nodeName: test-node-01
workspaces:
  - key: proj
    name: Project
    path: ${workspaceDir}
agents:
  - key: diagnostic
    type: diagnostic
    name: Built-in Diagnostic Agent
maxConcurrentRuns: 3
${extra}
`;

describe("loadConfigFile", () => {
  it("loads a valid configuration with defaults applied", () => {
    const config = loadConfigFile(writeConfig(validYaml()));
    expect(config.nodeName).toBe("test-node-01");
    expect(config.maxConcurrentRuns).toBe(3);
    expect(config.workspaces[0]?.readOnly).toBe(false);
    expect(config.agents[0]?.enabled).toBe(true);
    expect(config.allowInsecureHttp).toBe(false);
  });

  it("rejects plain http server URLs unless the dev escape hatch is set", () => {
    const insecure = validYaml().replace("https://", "http://");
    expect(() => loadConfigFile(writeConfig(insecure))).toThrow(/TLS/);
    const allowed = `${insecure}\nallowInsecureHttp: true\n`;
    expect(() => loadConfigFile(writeConfig(allowed))).not.toThrow();
  });

  it("rejects duplicate workspace keys", () => {
    const dupe = validYaml(`
`).replace(
      "workspaces:",
      `workspaces:
  - key: proj
    name: Duplicate
    path: ${workspaceDir}`,
    );
    expect(() => loadConfigFile(writeConfig(dupe))).toThrow(/duplicate workspace key/);
  });

  it("rejects workspace keys that look like paths", () => {
    const bad = validYaml().replace("key: proj", "key: ../escape");
    expect(() => loadConfigFile(writeConfig(bad))).toThrow(/invalid node configuration/);
  });

  it("rejects missing files and invalid YAML", () => {
    expect(() => loadConfigFile(path.join(dir, "nope.yaml"))).toThrow(/cannot read/);
    expect(() => loadConfigFile(writeConfig("{{{{not yaml"))).toThrow(/not valid YAML/);
  });
});

describe("validateConfig", () => {
  it("canonicalizes existing workspaces and reports missing ones", async () => {
    const config = loadConfigFile(
      writeConfig(
        validYaml(`
`).replace(
          "workspaces:",
          `workspaces:
  - key: missing
    name: Missing
    path: ${path.join(dir, "does-not-exist")}`,
        ),
      ),
    );
    const validated = await validateConfig(config);
    expect(validated.workspaces.map((w) => w.key)).toEqual(["proj"]);
    expect(validated.workspaces[0]?.canonicalPath).toBeTruthy();
    expect(validated.workspaceErrors).toHaveLength(1);
    expect(validated.workspaceErrors[0]?.key).toBe("missing");
    expect(validated.workspaceErrors[0]?.error).toContain("not_found");
  });
});
