import { useLocalSearchParams } from "expo-router";
import { WebScreen } from "@/components/web-screen";

/** A web page opened from the Library list. */
export default function LibraryPage() {
  const { path, title } = useLocalSearchParams<{
    path: string;
    title?: string;
  }>();
  return <WebScreen path={path || "/"} title={title ?? ""} />;
}
