import { Badge } from "@steward/ui";
import type { RunStatus } from "@/lib/types";

const STATUS_STYLES: Record<
  RunStatus,
  { variant: React.ComponentProps<typeof Badge>["variant"]; label: string }
> = {
  queued: { variant: "secondary", label: "Queued" },
  dispatching: { variant: "info", label: "Dispatching" },
  running: { variant: "info", label: "Running" },
  succeeded: { variant: "success", label: "Succeeded" },
  failed: { variant: "destructive", label: "Failed" },
  cancellation_requested: { variant: "warning", label: "Cancelling" },
  cancelled: { variant: "outline", label: "Cancelled" },
  timed_out: { variant: "warning", label: "Timed out" },
  lost: { variant: "destructive", label: "Lost" },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant={style.variant} data-status={status}>
      {(status === "running" || status === "dispatching") && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />
      )}
      {style.label}
    </Badge>
  );
}
