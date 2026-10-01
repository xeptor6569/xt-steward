import { Badge } from "@steward/ui";

export function NodeStatusBadge({ status }: { status: "online" | "offline" }) {
  return status === "online" ? (
    <Badge variant="success" data-status="online">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
      Online
    </Badge>
  ) : (
    <Badge variant="outline" data-status="offline">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" aria-hidden="true" />
      Offline
    </Badge>
  );
}
