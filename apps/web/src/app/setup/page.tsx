import { redirect } from "next/navigation";
import { fetchServerSession } from "@/lib/server-session";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const { user, needsSetup } = await fetchServerSession();
  if (!needsSetup) {
    redirect(user ? "/dashboard" : "/login");
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <SetupForm />
    </div>
  );
}
