import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
  }>;
};

function normalizeCallbackUrl(value: string | string[] | undefined): string {
  const raw = typeof value === "string" ? value : (value?.[0] ?? "");
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const sp = await searchParams;
  const callbackUrl = normalizeCallbackUrl(sp.callbackUrl);

  return (
    <main className="ot-page">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-4">
        <header className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">Sign in</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Use your owntube account to keep history and interactions private.
          </p>
        </header>
        <LoginForm callbackUrl={callbackUrl} />
        <div className="space-y-1 text-sm text-[hsl(var(--muted-foreground))]">
          <p>
            No account yet?{" "}
            <Link
              className="font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
              href="/register"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
