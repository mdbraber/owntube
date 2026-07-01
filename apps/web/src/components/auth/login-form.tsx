"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
          callbackUrl: "/",
        });
        setLoading(false);
        if (result?.ok) {
          // Stay on the current origin. `result.url` is resolved against
          // AUTH_URL and may point to a different host (e.g. the LAN IP), where
          // the freshly-set session cookie does not exist — navigating there
          // lands the user on the home page still logged out. Keep only the
          // path so login works from localhost, the LAN IP, Tailscale, etc.
          let dest = "/";
          if (result.url) {
            try {
              const parsed = new URL(result.url);
              dest = `${parsed.pathname}${parsed.search}` || "/";
            } catch {
              dest = "/";
            }
          }
          window.location.href = dest;
          return;
        }
        setError("Invalid credentials.");
      }}
    >
      <Input type="email" name="email" placeholder="you@example.com" required />
      <Input type="password" name="password" placeholder="Password" required />
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
