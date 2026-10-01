"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  EnrollmentTokenDto,
  NodeDetailsDto,
  NodeDto,
  RunDetailsDto,
  RunDto,
  RunEventDto,
  UserDto,
  WorkspaceDto,
} from "./types";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ user: UserDto | null }>("/api/v1/auth/session"),
    staleTime: 30_000,
  });
}

export function useNodes() {
  return useQuery({
    queryKey: ["nodes"],
    queryFn: () => api<{ nodes: NodeDto[] }>("/api/v1/nodes"),
    refetchInterval: 5000,
  });
}

export function useNode(nodeId: string) {
  return useQuery({
    queryKey: ["nodes", nodeId],
    queryFn: () => api<NodeDetailsDto>(`/api/v1/nodes/${nodeId}`),
    refetchInterval: 5000,
  });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<{ workspaces: WorkspaceDto[] }>("/api/v1/workspaces"),
    refetchInterval: 10_000,
  });
}

export function useRuns(filters: { status?: string; nodeId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.nodeId) params.set("nodeId", filters.nodeId);
  const query = params.toString();
  return useQuery({
    queryKey: ["runs", filters],
    queryFn: () => api<{ runs: RunDto[] }>(`/api/v1/runs${query ? `?${query}` : ""}`),
    refetchInterval: 5000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["runs", runId],
    queryFn: () => api<RunDetailsDto>(`/api/v1/runs/${runId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      const active =
        status === undefined ||
        ["queued", "dispatching", "running", "cancellation_requested"].includes(status);
      return active ? 3000 : false;
    },
  });
}

export function useRunEventsSnapshot(runId: string) {
  return useQuery({
    queryKey: ["runs", runId, "events"],
    queryFn: () =>
      api<{ events: RunEventDto[]; lastSequence: number }>(`/api/v1/runs/${runId}/events`),
    staleTime: Infinity,
  });
}

export function useEnrollmentTokens() {
  return useQuery({
    queryKey: ["enrollment-tokens"],
    queryFn: () => api<{ tokens: EnrollmentTokenDto[] }>("/api/v1/node-enrollment-tokens"),
  });
}

export function useCreateEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; expiresInMinutes?: number }) =>
      api<{ token: EnrollmentTokenDto & { plaintext: string } }>("/api/v1/node-enrollment-tokens", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["enrollment-tokens"] }),
  });
}

export function useRevokeEnrollmentToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/api/v1/node-enrollment-tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["enrollment-tokens"] }),
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workspaceId: string; task?: string | null }) =>
      api<{ run: RunDto }>("/api/v1/runs", {
        method: "POST",
        body: { workspaceId: input.workspaceId, type: "diagnostic", task: input.task ?? null },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["runs"] }),
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      api<{ run: RunDto; alreadyTerminal: boolean }>(`/api/v1/runs/${runId}/cancel`, {
        method: "POST",
        body: {},
      }),
    onSuccess: (_data, runId) => {
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
      void queryClient.invalidateQueries({ queryKey: ["runs", runId] });
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api<void>("/api/v1/auth/logout", { method: "POST", body: {} }),
  });
}
