"use client";

import {
  Badge,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@steward/ui";
import Link from "next/link";
import { CreateRunDialog } from "@/components/create-run-dialog";
import { NodeStatusBadge } from "@/components/node-status-badge";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { useWorkspaces } from "@/lib/queries";

export default function WorkspacesPage() {
  const workspaces = useWorkspaces();

  return (
    <div>
      <PageHeader
        title="Workspaces"
        description="Directories approved in each node's local configuration. The control plane references them only by key."
        actions={<CreateRunDialog />}
      />

      {workspaces.isError ? (
        <ErrorState message="Failed to load workspaces." />
      ) : workspaces.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : workspaces.data.workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces registered"
          description="Add workspaces to a node's config file (steward-node.yaml) and restart the node daemon; they are advertised automatically."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Node</TableHead>
              <TableHead>Local path</TableHead>
              <TableHead>Repository</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspaces.data.workspaces.map((ws) => (
              <TableRow key={ws.id}>
                <TableCell className="font-medium">{ws.name}</TableCell>
                <TableCell className="font-mono text-xs">{ws.externalKey}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/nodes/${ws.nodeId}`}
                      className="text-sm underline-offset-4 hover:underline"
                    >
                      {ws.nodeName ?? ws.nodeId}
                    </Link>
                    {ws.nodeStatus ? <NodeStatusBadge status={ws.nodeStatus} /> : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                  {ws.localPath}
                </TableCell>
                <TableCell className="max-w-52 truncate text-xs text-muted-foreground">
                  {ws.repositoryUrl ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={ws.readOnly ? "warning" : "secondary"}>
                    {ws.readOnly ? "Read-only" : "Read-write"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={ws.enabled ? "success" : "outline"}>
                    {ws.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
