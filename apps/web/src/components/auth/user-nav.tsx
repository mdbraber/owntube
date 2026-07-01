import Link from "next/link";
import { UserMenu } from "@/components/auth/user-menu";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/server/auth";

function userInitial(session: {
  user?: { name?: string | null; email?: string | null };
}): string {
  const n = session.user?.name?.trim();
  if (n) return n.slice(0, 1).toUpperCase();
  const e = session.user?.email?.trim();
  if (e) return e.slice(0, 1).toUpperCase();
  return "?";
}

export async function UserNav() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-8 rounded-[var(--radius-shell)] px-3 font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <Link href="/login">Sign in</Link>
        </Button>
        <Button
          size="sm"
          asChild
          className="h-8 rounded-[var(--radius-shell)] px-3 font-semibold"
        >
          <Link href="/register">Register</Link>
        </Button>
      </div>
    );
  }

  const initial = userInitial(session);

  return (
    <UserMenu
      initial={initial}
      name={session.user?.name}
      email={session.user?.email}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    />
  );
}
