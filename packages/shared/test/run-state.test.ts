import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  canTransitionRun,
  isTerminalRunStatus,
  RUN_STATUSES,
  RUN_TRANSITIONS,
  statusesAllowingTransitionTo,
  TERMINAL_RUN_STATUSES,
} from "../src/run-state.js";

describe("run state machine", () => {
  it("classifies every status as exactly one of active or terminal", () => {
    for (const status of RUN_STATUSES) {
      const active = (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
      const terminal = (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
      expect(active !== terminal, `${status} must be active xor terminal`).toBe(true);
    }
  });

  it("terminal states have no outgoing transitions", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(RUN_TRANSITIONS[status]).toEqual([]);
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });

  it("no transition ever targets queued (nothing re-enters the initial state)", () => {
    for (const status of RUN_STATUSES) {
      expect(RUN_TRANSITIONS[status]).not.toContain("queued");
    }
  });

  it("allows the happy path queued -> dispatching -> running -> succeeded", () => {
    expect(canTransitionRun("queued", "dispatching")).toBe(true);
    expect(canTransitionRun("dispatching", "running")).toBe(true);
    expect(canTransitionRun("running", "succeeded")).toBe(true);
  });

  it("allows the cancellation path including the finished-first race", () => {
    expect(canTransitionRun("running", "cancellation_requested")).toBe(true);
    expect(canTransitionRun("cancellation_requested", "cancelled")).toBe(true);
    // Run finished on the node before the cancel command landed:
    expect(canTransitionRun("cancellation_requested", "succeeded")).toBe(true);
    expect(canTransitionRun("cancellation_requested", "failed")).toBe(true);
  });

  it("allows cancelling a queued run directly", () => {
    expect(canTransitionRun("queued", "cancelled")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    for (const from of TERMINAL_RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        expect(canTransitionRun(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("rejects skipping dispatch from queued directly to running", () => {
    expect(canTransitionRun("queued", "running")).toBe(false);
  });

  it("computes the inverse map used for conditional SQL updates", () => {
    expect(statusesAllowingTransitionTo("cancelled").sort()).toEqual(
      ["cancellation_requested", "queued"].sort(),
    );
    expect(statusesAllowingTransitionTo("running")).toEqual(["dispatching"]);
    expect(statusesAllowingTransitionTo("queued")).toEqual([]);
  });
});
