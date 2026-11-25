import { WebScreen } from "@/components/web-screen";
import { usePendingLink } from "@/lib/use-incoming-links";

/** Home: the web home page. Links that open the app land here too. */
export default function HomeScreen() {
  const link = usePendingLink();
  return (
    <WebScreen
      path={link?.path ?? "/"}
      nonce={link ? String(link.serial) : undefined}
      title="Home"
    />
  );
}
