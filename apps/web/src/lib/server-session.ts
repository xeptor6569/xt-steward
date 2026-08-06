import { cookies } from "next/headers";
import type { UserDto } from "./types";

/**
 * Server-side session lookup for route guards. Uses the internal API URL
 * (container-to-container in Docker) and forwards the browser's cookies.
 */
export async function fetchServerSession(): Promise<{
  user: UserDto | null;
  needsSetup: boolean;
}> {
  const base = process.env.STEWARD_API_INTERNAL_URL ?? "http://localhost:3001";
  const cookieHeader = (await cookies()).toString();

  try {
    const [sessionRes, setupRes] = await Promise.all([
      fetch(`${base}/api/v1/auth/session`, {
        headers: { cookie: cookieHeader },
        cache: "no-store",
      }),
      fetch(`${base}/api/v1/setup/status`, { cache: "no-store" }),
    ]);
    const session = sessionRes.ok
      ? ((await sessionRes.json()) as { user: UserDto | null })
      : { user: null };
    const setup = setupRes.ok
      ? ((await setupRes.json()) as { needsSetup: boolean })
      : { needsSetup: false };
    return { user: session.user, needsSetup: setup.needsSetup };
  } catch {
    // API unreachable: treat as logged out; pages render their error states.
    return { user: null, needsSetup: false };
  }
}
