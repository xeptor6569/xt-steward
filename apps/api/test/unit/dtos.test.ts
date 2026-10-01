import { describe, expect, it } from "vitest";
import { toNodeDto, toRunDto } from "../../src/lib/dtos.js";

const now = new Date("2026-01-02T03:04:05.000Z");

describe("DTO mapping", () => {
  it("serializes node timestamps as ISO strings and never exposes credentialHash", () => {
    const dto = toNodeDto(
      {
        id: "node_1",
        name: "home-server-01",
        status: "online",
        version: "0.1.0",
        labels: { region: "home" },
        capabilities: { cpus: 8 },
        credentialHash: "super-secret-hash",
        lastConnectedAt: now,
        lastHeartbeatAt: null,
        maxConcurrentRuns: 2,
        createdAt: now,
        updatedAt: now,
      },
      3,
    );
    expect(dto.lastConnectedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(dto.lastHeartbeatAt).toBeNull();
    expect(dto.activeRunCount).toBe(3);
    expect(JSON.stringify(dto)).not.toContain("super-secret-hash");
  });

  it("serializes run timestamps and nullable fields", () => {
    const dto = toRunDto(
      {
        id: "run_1",
        workspaceId: "ws_1",
        nodeId: "node_1",
        agentDefinitionId: null,
        type: "diagnostic",
        status: "queued",
        requestedByUserId: "usr_1",
        task: null,
        queuedAt: now,
        startedAt: null,
        finishedAt: null,
        exitCode: null,
        errorCode: null,
        errorMessage: null,
        cancellationRequestedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      { workspaceName: "Fixture", nodeName: "home-server-01" },
    );
    expect(dto.queuedAt).toBe(now.toISOString());
    expect(dto.startedAt).toBeNull();
    expect(dto.workspaceName).toBe("Fixture");
    expect(dto.nodeName).toBe("home-server-01");
  });
});
