"use client";

import { Button, cn, Separator } from "@steward/ui";
import {
  ActivityIcon,
  FolderGitIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  ServerIcon,
  SettingsIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useLogout } from "@/lib/queries";
import type { UserDto } from "@/lib/types";
import { ThemeToggle } from "./theme-toggle";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/nodes", label: "Nodes", icon: ServerIcon },
  { href: "/workspaces", label: "Workspaces", icon: FolderGitIcon },
  { href: "/runs", label: "Runs", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({ user, children }: { user: UserDto; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-14 items-center gap-2 px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            S
          </div>
          <span className="font-semibold tracking-tight">Steward XT</span>
        </div>
        <Separator />
        <nav aria-label="Main navigation" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Separator />
        <div className="p-3">
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Log out"
              onClick={async () => {
                await logout.mutateAsync();
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOutIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
          <nav aria-label="Mobile navigation" className="flex gap-1 md:hidden">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                className={cn(
                  "rounded-md p-2",
                  pathname.startsWith(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
              </Link>
            ))}
          </nav>
          <div className="hidden md:block" />
          <ThemeToggle />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
