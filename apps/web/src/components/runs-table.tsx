"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@steward/ui";
import Link from "next/link";
import { formatDuration, formatRelative } from "@/lib/format";
import type { RunDto } from "@/lib/types";
import { EmptyState } from "./page-header";
import { RunStatusBadge } from "./run-status-badge";

export function RunsTable({ runs, emptyHint }: { runs: RunDto[]; emptyHint?: string }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        description={emptyHint ?? "Submit a diagnostic run from a workspace to see it here."}
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Workspace</TableHead>
          <TableHead>Node</TableHead>
          <TableHead>Queued</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell>
              <Link
                href={`/runs/${run.id}`}
                className="font-mono text-xs underline-offset-4 hover:underline"
              >
                {run.id.slice(0, 16)}…
              </Link>
            </TableCell>
            <TableCell>
              <RunStatusBadge status={run.status} />
            </TableCell>
            <TableCell className="text-sm">{run.workspaceName ?? run.workspaceId}</TableCell>
            <TableCell className="text-sm">{run.nodeName ?? run.nodeId}</TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatRelative(run.queuedAt)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDuration(run.startedAt, run.finishedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
