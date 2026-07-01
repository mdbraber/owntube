import { MobileAccountSheet } from "@/components/shell/mobile-account-sheet";
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

export async function MobileAccountMenu() {
  const session = await auth();
  const isLoggedIn = Boolean(session?.user?.id);

  return (
    <MobileAccountSheet
      isLoggedIn={isLoggedIn}
      initial={isLoggedIn ? userInitial(session ?? {}) : "?"}
      name={session?.user?.name}
      email={session?.user?.email}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    />
  );
}
