import { redirect } from "next/navigation";

/**
 * The channels list lives in the Channels tab on /subscriptions now; keep
 * this route for old links and redirect.
 */
export default function SubscriptionChannelsPage() {
  redirect("/subscriptions");
}
