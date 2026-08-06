"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@steward/ui";
import { use } from "react";
import { NodeStatusBadge } from "@/components/node-status-badge";
import { ErrorState, PageHeader } from "@/components/page-header";
import { RunsTable } from "@/components/runs-table";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useNode } from "@/lib/queries";

export default function NodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = use(params);
  const query = useNode(nodeId);

  if (query.isError) {
    return <ErrorState message="Node not found or the API is unreachable." />;
  }
  if (query.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  const { node, workspaces, agents, recentRuns } = query.data;

  return (
    <div>
      <PageHeader
        title={node.name}
        description={`Enrolled ${formatDateTime(node.createdAt)}`}
        actions={<NodeStatusBadge status={node.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Version</dt>
              <dd>{node.version ?? "—"}</dd>
              <dt className="text-muted-foreground">Last connected</dt>
              <dd>{formatDateTime(node.lastConnectedAt)}</dd>
              <dt className="text-muted-foreground">Last heartbeat</dt>
              <dd>
                {formatRelative(node.lastHeartbeatAt)}{" "}
                <span className="text-muted-foreground">
                  ({formatDateTime(node.lastHeartbeatAt)})
                </span>
              </dd>
              <dt className="text-muted-foreground">Concurrency</dt>
              <dd>
                {node.activeRunCount} active / {node.maxConcurrentRuns} max
              </dd>
              <dt className="text-muted-foreground">Labels</dt>
              <dd className="flex flex-wrap gap-1">
                {Object.entries(node.labels).length === 0
                  ? "—"
                  : Object.entries(node.labels).map(([k, v]) => (
                      <Badge key={k} variant="secondary">
                        {k}={v}
                      </Badge>
                    ))}
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              {Object.entries(node.capabilities).map(([key, value]) => (
                <FragmentRow key={key} label={key} value={String(value)} />
              ))}
              {Object.keys(node.capabilities).length === 0 ? (
                <p className="text-muted-foreground">Reported after first connection.</p>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Workspaces</h2>
      {workspaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This node advertises no workspaces. Add them to the node&apos;s local config file.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Local path</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Enabled</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspaces.map((ws) => (
              <TableRow key={ws.id}>
                <TableCell className="font-medium">{ws.name}</TableCell>
                <TableCell className="font-mono text-xs">{ws.externalKey}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {ws.localPath}
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

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Agents</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Enabled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id}>
              <TableCell className="font-medium">{agent.name}</TableCell>
              <TableCell className="font-mono text-xs">{agent.externalKey}</TableCell>
              <TableCell className="text-sm">{agent.type}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {agent.version ?? "—"}
              </TableCell>
              <TableCell>
                <Badge variant={agent.enabled ? "success" : "outline"}>
                  {agent.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Recent runs</h2>
      <RunsTable runs={recentRuns} emptyHint="Runs dispatched to this node will appear here." />
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{value}</dd>
    </>
  );
}
