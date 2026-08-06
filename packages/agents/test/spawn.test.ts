import os from "node:os";
import { describe, expect, it } from "vitest";
import { abortableSleep, isAbortError, spawnCollect } from "../src/spawn.js";

const node = process.execPath;

describe("spawnCollect", () => {
  it("captures stdout and stderr separately", async () => {
    const result = await spawnCollect(node, ["-e", "console.log('out'); console.error('err');"], {
      cwd: os.tmpdir(),
      timeoutMs: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
    expect(result.timedOut).toBe(false);
  });

  it("does not interpret shell metacharacters (no shell involved)", async () => {
    const result = await spawnCollect(
      node,
      ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", "$(whoami)", "; rm -rf /"],
      { cwd: os.tmpdir(), timeoutMs: 10_000 },
    );
    expect(JSON.parse(result.stdout)).toEqual(["$(whoami)", "; rm -rf /"]);
  });

  it("passes only an allowlisted environment to children", async () => {
    process.env.STEWARD_TEST_SECRET_VALUE = "super-secret-value";
    try {
      const result = await spawnCollect(
        node,
        ["-e", "console.log(JSON.stringify(Object.keys(process.env).sort()))"],
        { cwd: os.tmpdir(), timeoutMs: 10_000 },
      );
      const keys = JSON.parse(result.stdout) as string[];
      expect(keys).not.toContain("STEWARD_TEST_SECRET_VALUE");
    } finally {
      delete process.env.STEWARD_TEST_SECRET_VALUE;
    }
  });

  it("terminates a hanging process on timeout", async () => {
    const started = Date.now();
    const result = await spawnCollect(node, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: os.tmpdir(),
      timeoutMs: 500,
      killGraceMs: 500,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("force-kills a SIGTERM-ignoring process after the grace period", async () => {
    const script = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
    const result = await spawnCollect(node, ["-e", script], {
      cwd: os.tmpdir(),
      timeoutMs: 300,
      killGraceMs: 400,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull(); // killed by signal
  });

  it("stops when the abort signal fires (cancellation)", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("cancelled"), 200);
    const result = await spawnCollect(node, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: os.tmpdir(),
      timeoutMs: 30_000,
      killGraceMs: 300,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });

  it("caps captured output size", async () => {
    const result = await spawnCollect(node, ["-e", "process.stdout.write('x'.repeat(100000))"], {
      cwd: os.tmpdir(),
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });
});

describe("abortableSleep", () => {
  it("resolves normally when not aborted", async () => {
    await expect(abortableSleep(10)).resolves.toBeUndefined();
  });

  it("rejects with an abort error when cancelled", async () => {
    const controller = new AbortController();
    const sleep = abortableSleep(10_000, controller.signal);
    controller.abort("cancelled");
    await expect(sleep).rejects.toSatisfy(isAbortError);
  });
});
