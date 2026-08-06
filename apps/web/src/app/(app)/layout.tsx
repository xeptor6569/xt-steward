import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { fetchServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user, needsSetup } = await fetchServerSession();
  if (needsSetup) redirect("/setup");
  if (!user) redirect("/login");
  return <AppShell user={user}>{children}</AppShell>;
}
