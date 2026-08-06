import { spawn } from "node:child_process";

export interface SpawnCollectOptions {
  cwd: string;
  timeoutMs: number;
  /** After SIGTERM, wait this long before SIGKILL. */
  killGraceMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface SpawnCollectResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
}

const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * Minimal environment passed to child processes. Deliberately excludes the
 * parent environment so credentials and other secrets can never leak into
 * run output. `GIT_TERMINAL_PROMPT=0` prevents git from blocking on input.
 */
function childEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    HOME: process.env.HOME,
  };
}

/**
 * Spawns `executable` with an argument array — never a shell — collects
 * stdout/stderr separately with a size cap, and enforces a timeout with
 * graceful (SIGTERM) then forced (SIGKILL) termination of the process group.
 */
export function spawnCollect(
  executable: string,
  args: readonly string[],
  options: SpawnCollectOptions,
): Promise<SpawnCollectResult> {
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const killGraceMs = options.killGraceMs ?? 3000;

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
        truncated: false,
      });
      return;
    }

    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group so SIGTERM/SIGKILL reach grandchildren too.
      detached: process.platform !== "win32",
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let aborted = false;
    let killTimer: NodeJS.Timeout | undefined;

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const current = target === "stdout" ? stdout : stderr;
      if (current.length >= maxBytes) {
        truncated = true;
        return;
      }
      const room = maxBytes - current.length;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (chunk.length > room) truncated = true;
      if (target === "stdout") stdout = Buffer.concat([current, slice]);
      else stderr = Buffer.concat([current, slice]);
    };

    child.stdout?.on("data", (c: Buffer) => append("stdout", c));
    child.stderr?.on("data", (c: Buffer) => append("stderr", c));

    const killTree = (sig: NodeJS.Signals) => {
      const pid = child.pid;
      if (pid === undefined) return;
      try {
        if (process.platform !== "win32") process.kill(-pid, sig);
        else child.kill(sig);
      } catch {
        try {
          child.kill(sig);
        } catch {
          // Process already exited between the check and the kill; nothing to do.
        }
      }
    };

    const terminate = () => {
      killTree("SIGTERM");
      killTimer = setTimeout(() => killTree("SIGKILL"), killGraceMs);
      killTimer.unref();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    timeoutTimer.unref();

    const onAbort = () => {
      aborted = true;
      terminate();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });

    child.on("close", (code) => {
      cleanup();
      resolve({
        exitCode: code,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        aborted,
        truncated,
      });
    });
  });
}

/** Sleep that resolves early (rejecting) when the signal aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(signal?: AbortSignal): Error {
  const err = new Error(
    typeof signal?.reason === "string" ? `aborted: ${signal.reason}` : "aborted",
  );
  err.name = "AbortError";
  return err;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}
