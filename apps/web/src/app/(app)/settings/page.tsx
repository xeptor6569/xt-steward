"use client";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@steward/ui";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/queries";

export default function SettingsPage() {
  const session = useSession();
  const user = session.data?.user;

  return (
    <div>
      <PageHeader title="Settings" description="Your account and control plane configuration." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>The local account you are signed in with.</CardDescription>
          </CardHeader>
          <CardContent>
            {session.isPending || !user ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Display name</dt>
                <dd>{user.displayName}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd>{user.email ?? "—"}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                    {user.role}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDateTime(user.createdAt)}</dd>
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign-in methods</CardTitle>
            <CardDescription>How users authenticate to this control plane.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">Email &amp; password</p>
                <p className="text-xs text-muted-foreground">
                  Local accounts with scrypt-hashed passwords.
                </p>
              </div>
              <Badge variant="success">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">GitHub OAuth</p>
                <p className="text-xs text-muted-foreground">
                  Planned for a future milestone. Configuration variables are reserved
                  (STEWARD_GITHUB_OAUTH_CLIENT_ID) but no GitHub integration is active.
                </p>
              </div>
              <Badge variant="outline">Coming soon</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
