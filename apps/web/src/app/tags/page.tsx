import { redirect } from "next/navigation";
import { TaggedChannelsView } from "@/components/favorites/tagged-channels-view";
import { PageHeader } from "@/components/layout/page-header";
import { SectionOptionsMenu } from "@/components/library/section-options-menu";
import { normalizeChannelTag } from "@/lib/channel-tag";
import { tagBundleLabel, tagViewHref } from "@/lib/home-blocks";
import { auth } from "@/server/auth";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function tagParam(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map(normalizeChannelTag).filter((t) => t !== null))];
}

/** A tag or tag bundle (`?tag=a&tag=b&match=all&not=c`), as a tag block links. */
export default async function TagsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const includeTags = tagParam(params.tag);
  const excludeTags = tagParam(params.not);
  const tagMatch = params.match === "all" ? "all" : "any";
  const session = await auth();
  if (!session?.user?.id) {
    const back = tagViewHref({ includeTags, excludeTags, tagMatch });
    redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  }
  if (includeTags.length === 0) redirect("/subscriptions");

  return (
    <main className="ot-page space-y-8">
      <PageHeader
        title={tagBundleLabel(includeTags, tagMatch)}
        subtitle={
          tagMatch === "all" && includeTags.length > 1
            ? "Subscribed channels carrying all of these tags."
            : "Subscribed channels carrying any of these tags."
        }
      >
        <SectionOptionsMenu section="tags" />
      </PageHeader>
      <TaggedChannelsView
        filter={{ includeTags, excludeTags, tagMatch }}
        section="tags"
        empty="No subscribed channel carries these tags."
      />
    </main>
  );
}
