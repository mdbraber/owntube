import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <main className="ot-page">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 py-4">
        <header className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Create account
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            owntube stores your account only in your local SQLite database.
          </p>
        </header>
        <RegisterForm />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Already registered?{" "}
          <Link
            className="font-medium text-[hsl(var(--primary))] underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
