import type { ChildProcess } from "node:child_process";

export default async function globalTeardown(): Promise<void> {
  const children =
    ((globalThis as Record<string, unknown>).__stewardE2eChildren as ChildProcess[] | undefined) ??
    [];
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.killed) return resolve();
          child.once("exit", () => resolve());
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null) child.kill("SIGKILL");
            resolve();
          }, 5000).unref();
        }),
    ),
  );
}
