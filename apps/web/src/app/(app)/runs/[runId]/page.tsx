"use client";

import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@steward/ui";
import { OctagonXIcon } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { LogViewer } from "@/components/log-viewer";
import { ErrorState, PageHeader } from "@/components/page-header";
import { RunStatusBadge } from "@/components/run-status-badge";
import { ApiError } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useCancelRun, useRun } from "@/lib/queries";
import { isTerminalStatus } from "@/lib/types";

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const query = useRun(runId);
  const cancelRun = useCancelRun();
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (query.isError) {
    return <ErrorState message="Run not found or the API is unreachable." />;
  }
  if (query.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }

  const { run, node, workspace, agent } = query.data;
  const terminal = isTerminalStatus(run.status);
  const cancellable = !terminal && run.status !== "cancellation_requested";

  return (
    <div>
      <PageHeader
        title="Run details"
        description={run.id}
        actions={
          <div className="flex items-center gap-3">
            <RunStatusBadge status={run.status} />
            {!terminal ? (
              <Button
                variant="destructive"
                disabled={!cancellable || cancelRun.isPending}
                onClick={async () => {
                  setCancelError(null);
                  try {
                    await cancelRun.mutateAsync(run.id);
                  } catch (err) {
                    setCancelError(
                      err instanceof ApiError ? err.message : "Failed to cancel the run",
                    );
                  }
                }}
              >
                <OctagonXIcon aria-hidden="true" />
                {run.status === "cancellation_requested"
                  ? "Cancelling…"
                  : cancelRun.isPending
                    ? "Requesting…"
                    : "Cancel run"}
              </Button>
            ) : null}
          </div>
        }
      />

      {cancelError ? (
        <div className="mb-4">
          <ErrorState message={cancelError} />
        </div>
      ) : null}
      {run.errorCode ? (
        <div className="mb-4">
          <ErrorState message={`${run.errorCode}: ${run.errorMessage ?? "no further details"}`} />
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Placement</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Node</dt>
              <dd>
                {node ? (
                  <Link href={`/nodes/${node.id}`} className="underline-offset-4 hover:underline">
                    {node.name}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt className="text-muted-foreground">Workspace</dt>
              <dd>{workspace ? `${workspace.name} (${workspace.externalKey})` : "—"}</dd>
              <dt className="text-muted-foreground">Agent</dt>
              <dd>{agent ? `${agent.name} (${agent.type})` : "—"}</dd>
              <dt className="text-muted-foreground">Task</dt>
              <dd className="break-all font-mono text-xs">{run.task ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timing</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Queued</dt>
              <dd>{formatDateTime(run.queuedAt)}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatDateTime(run.startedAt)}</dd>
              <dt className="text-muted-foreground">Finished</dt>
              <dd>{formatDateTime(run.finishedAt)}</dd>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{formatDuration(run.startedAt, run.finishedAt)}</dd>
              <dt className="text-muted-foreground">Exit code</dt>
              <dd>{run.exitCode ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <LogViewer runId={run.id} isTerminal={terminal} />
    </div>
  );
}
