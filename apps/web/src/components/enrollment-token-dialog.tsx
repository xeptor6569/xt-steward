"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
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
} from "@steward/ui";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useCreateEnrollmentToken } from "@/lib/queries";
import { CopyButton } from "./copy-button";
import { ErrorState } from "./page-header";

export function EnrollmentTokenDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createToken = useCreateEnrollmentToken();

  async function submit() {
    setError(null);
    try {
      const result = await createToken.mutateAsync({ name: name.trim() });
      setPlaintext(result.token.plaintext);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create token");
    }
  }

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("");
      setPlaintext(null);
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button>
          <KeyRoundIcon aria-hidden="true" />
          Create enrollment token
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create enrollment token</DialogTitle>
          <DialogDescription>
            One-time token for enrolling a new node. It expires automatically and can be revoked.
          </DialogDescription>
        </DialogHeader>

        {plaintext === null ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. home-server-01"
              />
            </div>
            {error ? <ErrorState message={error} /> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>Copy this token now</AlertTitle>
              <AlertDescription>
                It is shown exactly once and stored only as a hash. Use it on the node:
              </AlertDescription>
            </Alert>
            <code
              data-testid="enrollment-token-plaintext"
              className="block break-all rounded-md bg-muted p-3 font-mono text-xs"
            >
              {plaintext}
            </code>
            <div className="rounded-md bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
              steward-node enroll --server https://your-control-plane --token {"<token>"}
            </div>
            <CopyButton value={plaintext} label="Copy token" />
          </div>
        )}

        <DialogFooter>
          {plaintext === null ? (
            <>
              <Button variant="outline" onClick={() => reset(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={name.trim().length === 0 || createToken.isPending}
              >
                {createToken.isPending ? "Creating…" : "Create token"}
              </Button>
            </>
          ) : (
            <Button onClick={() => reset(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
