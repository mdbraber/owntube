"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/react";

export function RegisterForm() {
  const [error, setError] = useState<string | null>(null);
  const mutation = trpc.auth.register.useMutation();

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(null);
        const form = new FormData(event.currentTarget);
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");
        try {
          await mutation.mutateAsync({ email, password });
          const result = await signIn("credentials", {
            email,
            password,
            redirect: false,
            callbackUrl: "/",
          });
          if (result?.ok) {
            window.location.href = "/onboarding/taste";
          }
        } catch (mutationError) {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "Could not create account.",
          );
        }
      }}
    >
      <Input type="email" name="email" placeholder="you@example.com" required />
      <Input
        type="password"
        name="password"
        placeholder="Password (8+ chars)"
        required
      />
      {error ? (
        <p className="text-sm text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
