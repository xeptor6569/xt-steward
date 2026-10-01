import { realpathSync, statSync } from "node:fs";
import path from "node:path";

export type WorkspacePathErrorCode =
  "relative_path" | "path_traversal" | "not_found" | "not_directory" | "outside_workspace";

export class WorkspacePathError extends Error {
  constructor(
    readonly code: WorkspacePathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

/**
 * Validates an operator-configured workspace path. The local configuration is
 * authoritative for filesystem paths — the control plane can only ever
 * reference the resulting workspace by its key. Rules:
 * - absolute paths only
 * - no `..` traversal segments
 * - must exist and be a directory
 * - symlinks are resolved so the canonical path is what gets enforced later
 */
export function validateWorkspacePath(rawPath: string): { canonicalPath: string } {
  if (!path.isAbsolute(rawPath)) {
    throw new WorkspacePathError("relative_path", `workspace path must be absolute: ${rawPath}`);
  }
  if (rawPath.split(path.sep).includes("..")) {
    throw new WorkspacePathError(
      "path_traversal",
      `workspace path must not contain "..": ${rawPath}`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(rawPath);
  } catch {
    throw new WorkspacePathError("not_found", `workspace path does not exist: ${rawPath}`);
  }

  const stats = statSync(canonicalPath);
  if (!stats.isDirectory()) {
    throw new WorkspacePathError("not_directory", `workspace path is not a directory: ${rawPath}`);
  }
  return { canonicalPath };
}

/**
 * Resolves a child path strictly inside a canonical workspace root. Rejects
 * traversal and symlink escapes: the child's realpath must remain under the
 * workspace root. Used by any future feature that touches files within a
 * workspace on behalf of a run.
 */
export function resolveInsideWorkspace(canonicalRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new WorkspacePathError(
      "outside_workspace",
      "child paths must be relative to the workspace root",
    );
  }
  const candidate = path.resolve(canonicalRoot, relativePath);
  if (!isInside(canonicalRoot, candidate)) {
    throw new WorkspacePathError("path_traversal", `path escapes the workspace: ${relativePath}`);
  }

  // Resolve symlinks on the deepest existing ancestor so a symlink cannot
  // point outside the workspace.
  let probe = candidate;
  for (;;) {
    try {
      const real = realpathSync(probe);
      const suffix = candidate.slice(probe.length);
      const resolved = path.join(real, suffix);
      if (!isInside(canonicalRoot, resolved)) {
        throw new WorkspacePathError(
          "outside_workspace",
          `path resolves outside the workspace: ${relativePath}`,
        );
      }
      return resolved;
    } catch (err) {
      if (err instanceof WorkspacePathError) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new WorkspacePathError("not_found", `path cannot be resolved: ${relativePath}`);
      }
      probe = parent;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}
