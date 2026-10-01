import { redirect } from "next/navigation";
import { fetchServerSession } from "@/lib/server-session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { user, needsSetup } = await fetchServerSession();
  if (needsSetup) redirect("/setup");
  if (user) redirect("/dashboard");
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <LoginForm />
    </div>
  );
}
