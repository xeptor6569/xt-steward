import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // Integration tests share one database; keep them sequential.
          fileParallelism: false,
        },
      },
    ],
  },
});
