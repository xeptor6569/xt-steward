"use client";

import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@steward/ui";
import { ActivityIcon, FolderGitIcon, ServerIcon } from "lucide-react";
import Link from "next/link";
import { CreateRunDialog } from "@/components/create-run-dialog";
import { ErrorState, PageHeader } from "@/components/page-header";
import { RunsTable } from "@/components/runs-table";
import { useNodes, useRuns, useWorkspaces } from "@/lib/queries";

export default function DashboardPage() {
  const nodes = useNodes();
  const workspaces = useWorkspaces();
  const runs = useRuns();

  const onlineNodes = nodes.data?.nodes.filter((n) => n.status === "online").length ?? 0;
  const totalNodes = nodes.data?.nodes.length ?? 0;
  const workspaceCount = workspaces.data?.workspaces.filter((w) => w.enabled).length ?? 0;
  const activeRuns =
    runs.data?.runs.filter((r) =>
      ["queued", "dispatching", "running", "cancellation_requested"].includes(r.status),
    ).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Health of your nodes, workspaces, and recent agent runs."
        actions={<CreateRunDialog />}
      />

      {nodes.isError ? (
        <ErrorState message="Cannot reach the Steward XT API. Check that the API service is running." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              title="Nodes online"
              href="/nodes"
              icon={<ServerIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              loading={nodes.isPending}
              value={`${onlineNodes} / ${totalNodes}`}
            />
            <StatCard
              title="Workspaces"
              href="/workspaces"
              icon={<FolderGitIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              loading={workspaces.isPending}
              value={String(workspaceCount)}
            />
            <StatCard
              title="Active runs"
              href="/runs"
              icon={<ActivityIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              loading={runs.isPending}
              value={String(activeRuns)}
            />
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">Recent runs</h2>
          {runs.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <RunsTable runs={(runs.data?.runs ?? []).slice(0, 10)} />
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  href,
  icon,
  loading,
}: {
  title: string;
  value: string;
  href: string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Link href={href} className="focus-visible:outline-none">
      <Card className="transition-colors hover:bg-accent/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{value}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
