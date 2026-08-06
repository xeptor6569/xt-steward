"use client";

import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@steward/ui";
import { Trash2Icon } from "lucide-react";
import Link from "next/link";
import { EnrollmentTokenDialog } from "@/components/enrollment-token-dialog";
import { NodeStatusBadge } from "@/components/node-status-badge";
import { EmptyState, ErrorState, PageHeader } from "@/components/page-header";
import { formatRelative } from "@/lib/format";
import { useEnrollmentTokens, useNodes, useRevokeEnrollmentToken, useSession } from "@/lib/queries";

export default function NodesPage() {
  const nodes = useNodes();
  const session = useSession();
  const isAdmin = session.data?.user?.role === "admin";

  return (
    <div>
      <PageHeader
        title="Nodes"
        description="Machines enrolled in this control plane. Nodes connect outbound — no inbound ports required."
        actions={isAdmin ? <EnrollmentTokenDialog /> : undefined}
      />

      {nodes.isError ? (
        <ErrorState message="Failed to load nodes." />
      ) : nodes.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : nodes.data.nodes.length === 0 ? (
        <EmptyState
          title="No nodes enrolled"
          description="Create an enrollment token, then run `steward-node enroll` on the machine you want to connect."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last heartbeat</TableHead>
              <TableHead>Active runs</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.data.nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  <Link
                    href={`/nodes/${node.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <NodeStatusBadge status={node.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {node.version ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatRelative(node.lastHeartbeatAt)}
                </TableCell>
                <TableCell className="text-sm">
                  {node.activeRunCount} / {node.maxConcurrentRuns}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {isAdmin ? <EnrollmentTokensSection /> : null}
    </div>
  );
}

function EnrollmentTokensSection() {
  const tokens = useEnrollmentTokens();
  const revoke = useRevokeEnrollmentToken();

  const rows = tokens.data?.tokens ?? [];
  return (
    <div className="mt-10">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Enrollment tokens</h2>
      {tokens.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No enrollment tokens yet. Tokens are single-use and expire automatically.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-16">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((token) => {
              const state = token.revokedAt
                ? "Revoked"
                : token.usedAt
                  ? "Used"
                  : new Date(token.expiresAt) < new Date()
                    ? "Expired"
                    : "Active";
              return (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{state}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(token.expiresAt).replace(" ago", "")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelative(token.createdAt)}
                  </TableCell>
                  <TableCell>
                    {state === "Active" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Revoke token ${token.name}`}
                        onClick={() => revoke.mutate(token.id)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
