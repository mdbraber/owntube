import { useLocalSearchParams } from "expo-router";
import { WebScreen } from "@/components/web-screen";

/**
 * A tab's `page` route: one web page pushed onto the tab's stack (a link, a
 * Library row, a deep link). Its title comes from the page once it loads.
 */
export function WebPageRoute() {
  const { path, title } = useLocalSearchParams<{
    path: string;
    title?: string;
  }>();
  return <WebScreen path={path || "/"} title={title ?? ""} />;
}
