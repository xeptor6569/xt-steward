"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@steward/ui";
import { PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useCreateRun, useWorkspaces } from "@/lib/queries";
import { ErrorState } from "./page-header";

export function CreateRunDialog({ defaultWorkspaceId }: { defaultWorkspaceId?: string }) {
  const [open, setOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(defaultWorkspaceId ?? "");
  const [task, setTask] = useState("");
  const [error, setError] = useState<string | null>(null);
  const workspaces = useWorkspaces();
  const createRun = useCreateRun();
  const router = useRouter();

  const selectable = (workspaces.data?.workspaces ?? []).filter(
    (w) => w.enabled && w.nodeStatus === "online",
  );

  async function submit() {
    setError(null);
    try {
      const result = await createRun.mutateAsync({
        workspaceId,
        task: task.trim() === "" ? null : task.trim(),
      });
      setOpen(false);
      router.push(`/runs/${result.run.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create run");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlayIcon aria-hidden="true" />
          New diagnostic run
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New diagnostic run</DialogTitle>
          <DialogDescription>
            Runs the built-in diagnostic agent inside an approved workspace on its node. The control
            plane only ever references the workspace by key — never by path.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="run-workspace">Workspace</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger id="run-workspace" aria-label="Workspace">
                <SelectValue placeholder="Select a workspace on an online node" />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} — {w.nodeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectable.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No workspaces on online nodes. Enroll a node and configure a workspace first.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="run-task">Task (optional)</Label>
            <Input
              id="run-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder='e.g. "delay=10" to simulate a long diagnostic'
            />
          </div>
          {error ? <ErrorState message={error} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!workspaceId || createRun.isPending}>
            {createRun.isPending ? "Submitting…" : "Start run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
