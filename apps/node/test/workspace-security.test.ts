import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveInsideWorkspace,
  validateWorkspacePath,
  WorkspacePathError,
} from "../src/workspace-security.js";

let base: string;
let workspace: string;
let outside: string;

beforeAll(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "steward-wss-"));
  workspace = path.join(base, "workspace");
  outside = path.join(base, "outside");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(path.join(workspace, "src"));
  writeFileSync(path.join(workspace, "file.txt"), "inside");
  writeFileSync(path.join(outside, "secret.txt"), "outside");
  symlinkSync(outside, path.join(workspace, "sneaky-link"));
  symlinkSync(path.join(outside, "secret.txt"), path.join(workspace, "sneaky-file"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof WorkspacePathError ? err.code : "unexpected";
  }
}

describe("validateWorkspacePath", () => {
  it("accepts an existing absolute directory and returns the canonical path", () => {
    const { canonicalPath } = validateWorkspacePath(workspace);
    expect(path.isAbsolute(canonicalPath)).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(errorCode(() => validateWorkspacePath("projects/repo"))).toBe("relative_path");
    expect(errorCode(() => validateWorkspacePath("./repo"))).toBe("relative_path");
  });

  it("rejects traversal segments", () => {
    expect(errorCode(() => validateWorkspacePath(`${workspace}/../outside`))).toBe(
      "path_traversal",
    );
  });

  it("rejects missing paths", () => {
    expect(errorCode(() => validateWorkspacePath(path.join(base, "missing")))).toBe("not_found");
  });

  it("rejects files (workspaces must be directories)", () => {
    expect(errorCode(() => validateWorkspacePath(path.join(workspace, "file.txt")))).toBe(
      "not_directory",
    );
  });

  it("resolves symlinked workspace roots to their canonical location", () => {
    const link = path.join(base, "root-link");
    symlinkSync(workspace, link);
    const { canonicalPath } = validateWorkspacePath(link);
    expect(canonicalPath).toBe(validateWorkspacePath(workspace).canonicalPath);
  });
});

describe("resolveInsideWorkspace", () => {
  const root = () => validateWorkspacePath(workspace).canonicalPath;

  it("resolves ordinary child paths", () => {
    const resolved = resolveInsideWorkspace(root(), "src");
    expect(resolved.startsWith(root())).toBe(true);
  });

  it("rejects absolute child paths", () => {
    expect(errorCode(() => resolveInsideWorkspace(root(), "/etc/passwd"))).toBe(
      "outside_workspace",
    );
  });

  it("rejects .. traversal", () => {
    expect(errorCode(() => resolveInsideWorkspace(root(), "../outside/secret.txt"))).toBe(
      "path_traversal",
    );
    expect(errorCode(() => resolveInsideWorkspace(root(), "src/../../outside"))).toBe(
      "path_traversal",
    );
  });

  it("rejects symlink escapes through a linked directory", () => {
    expect(errorCode(() => resolveInsideWorkspace(root(), "sneaky-link/secret.txt"))).toBe(
      "outside_workspace",
    );
  });

  it("rejects symlink escapes through a linked file", () => {
    expect(errorCode(() => resolveInsideWorkspace(root(), "sneaky-file"))).toBe(
      "outside_workspace",
    );
  });
});
