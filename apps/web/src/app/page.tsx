import { redirect } from "next/navigation";
import { HomeBlocksClient } from "@/components/home/home-blocks-client";
import { auth } from "@/server/auth";

export default async function HomePage() {
  const session = await auth();
  // The modular home is built from personal library sections — signed-out
  // visitors land on the recommendation feed instead.
  if (!session?.user?.id) {
    redirect("/recommended");
  }

  return (
    <main className="ot-page">
      <HomeBlocksClient />
    </main>
  );
}
