"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@steward/ui";
import { useState } from "react";
import { CreateRunDialog } from "@/components/create-run-dialog";
import { ErrorState, PageHeader } from "@/components/page-header";
import { RunsTable } from "@/components/runs-table";
import { useRuns } from "@/lib/queries";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "dispatching", label: "Dispatching" },
  { value: "running", label: "Running" },
  { value: "cancellation_requested", label: "Cancelling" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "timed_out", label: "Timed out" },
  { value: "lost", label: "Lost" },
];

export default function RunsPage() {
  const [status, setStatus] = useState("all");
  const runs = useRuns(status === "all" ? {} : { status });

  return (
    <div>
      <PageHeader
        title="Runs"
        description="Diagnostic agent runs across all nodes."
        actions={<CreateRunDialog />}
      />

      <div className="mb-4 w-56">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {runs.isError ? (
        <ErrorState message="Failed to load runs." />
      ) : runs.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <RunsTable runs={runs.data.runs} />
      )}
    </div>
  );
}
