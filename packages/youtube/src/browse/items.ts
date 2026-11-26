import type {
  ChannelRef,
  ChannelSummary,
  PlaylistSummary,
  VideoSummary,
} from "@owntube/contracts/model";
import { YTNodes } from "youtubei.js";
import { toImages } from "./images.ts";
import { isClock, parseClock, parseCount } from "./text.ts";

/** What a list response contains, in YouTube's order. */
export interface Items {
  videos: VideoSummary[];
  channels: ChannelSummary[];
  playlists: PlaylistSummary[];
}

/**
 * Walks a parsed youtubei.js response and maps every item it recognises,
 * whatever wrappers (shelves, grids, rich items) YouTube puts around them.
 * A recognised item's children are not searched further.
 */
export function collectItems(root: unknown): Items {
  const items: Items = { videos: [], channels: [], playlists: [] };
  const seen = new Set<string>();
  const stack: unknown[] = [root];
  const visited = new Set<unknown>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    const mapped = mapItem(node);
    if (mapped) {
      const key = `${mapped.kind}:${"videoId" in mapped.value ? mapped.value.videoId : "channelId" in mapped.value ? mapped.value.channelId : mapped.value.playlistId}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (mapped.kind === "video") items.videos.push(mapped.value);
        else if (mapped.kind === "channel") items.channels.push(mapped.value);
        else items.playlists.push(mapped.value);
      }
      continue;
    }
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return items;
}

/** youtubei.js keeps parts of a parsed page in Maps (its node memo), as well as arrays and objects. */
function childrenOf(node: object): unknown[] {
  if (Array.isArray(node)) return node;
  if (node instanceof Map) return [...node.values()];
  return Object.values(node);
}

type Mapped =
  | { kind: "video"; value: VideoSummary }
  | { kind: "channel"; value: ChannelSummary }
  | { kind: "playlist"; value: PlaylistSummary };

export function mapItem(node: object): Mapped | undefined {
  if (node instanceof YTNodes.Video)
    return { kind: "video", value: fromVideo(node) };
  if (node instanceof YTNodes.ShortsLockupView) {
    const short = fromShortsLockup(node);
    return short ? { kind: "video", value: short } : undefined;
  }
  if (node instanceof YTNodes.LockupView) return fromLockup(node);
  if (node instanceof YTNodes.GridChannel || node instanceof YTNodes.Channel) {
    return { kind: "channel", value: fromChannel(node) };
  }
  return undefined;
}

function channelRef(
  author:
    | {
        id?: string;
        name?: string;
        thumbnails?: Array<{ url: string; width?: number; height?: number }>;
      }
    | undefined,
): ChannelRef | undefined {
  if (
    !author?.id ||
    author.id === "N/A" ||
    !author.name ||
    author.name === "N/A"
  )
    return undefined;
  return {
    channelId: author.id,
    name: author.name,
    avatars: toImages(author.thumbnails),
  };
}

function fromVideo(node: YTNodes.Video): VideoSummary {
  const badges = node.badges.map((b) => b.label ?? "").join(" ");
  const live = node.is_live ? "live" : node.is_upcoming ? "upcoming" : "none";
  const channel = channelRef(node.author);
  const durationSec =
    node.duration?.seconds || parseClock(node.length_text?.toString());
  const views =
    live === "live"
      ? undefined
      : parseCount(
          node.view_count?.toString() ?? node.short_view_count?.toString(),
        );
  const published = node.published?.toString();
  return {
    videoId: node.video_id,
    title: node.title.toString(),
    ...(channel ? { channel } : {}),
    thumbnails: toImages(node.thumbnails),
    ...(durationSec && live === "none" ? { durationSec } : {}),
    ...(views ? { views } : {}),
    ...(published ? { published: { text: published } } : {}),
    live,
    ...(node.upcoming ? { startsAt: node.upcoming.getTime() } : {}),
    isShort: false,
    ...(/members only/i.test(badges) ? { membersOnly: true } : {}),
  };
}

function fromShortsLockup(
  node: YTNodes.ShortsLockupView,
): VideoSummary | undefined {
  const payload = node.on_tap_endpoint?.payload as
    | { videoId?: string }
    | undefined;
  if (!payload?.videoId) return undefined;
  const title =
    node.overlay_metadata?.primary_text?.toString() ??
    node.accessibility_text.split(",")[0] ??
    "";
  const views = parseCount(node.overlay_metadata?.secondary_text?.toString());
  return {
    videoId: payload.videoId,
    title,
    thumbnails: toImages(node.thumbnail_view_model?.image ?? node.thumbnail),
    ...(views ? { views } : {}),
    live: "none",
    isShort: true,
  };
}

interface Text {
  toString(): string;
}
interface MetadataPart {
  text?: Text | null;
}

function fromLockup(node: YTNodes.LockupView): Mapped | undefined {
  const id = node.content_id;
  const meta = node.metadata;
  if (!id || !meta) return undefined;
  const title = meta.title?.toString() ?? "";
  const rows =
    (
      meta.metadata as unknown as {
        metadata_rows?: Array<{ metadata_parts?: MetadataPart[] }>;
      } | null
    )?.metadata_rows ?? [];
  const parts = rows
    .flatMap((r) =>
      (r.metadata_parts ?? []).map((p) => p.text?.toString() ?? ""),
    )
    .filter(Boolean);
  const image = meta.image as unknown as {
    a11y_label?: string;
    avatar?: {
      image?: Array<{ url: string; width?: number; height?: number }>;
    };
    avatars?: Array<{
      image?: Array<{ url: string; width?: number; height?: number }>;
    }>;
    renderer_context?: {
      command_context?: {
        on_tap?: { name?: string; payload?: { browseId?: string } };
      };
    };
  } | null;
  // A collaboration's avatar stack opens the list of credited channels instead of one channel.
  const onTap = image?.renderer_context?.command_context?.on_tap;
  const collaborators =
    onTap?.name === "showDialogCommand"
      ? collaboratorsFrom(
          onTap,
          (image?.avatars ?? []).map((a) => a.image ?? []),
        )
      : [];
  // The channel comes with its avatar: a link to it, labelled "Go to channel <name>". On a
  // channel's own pages there is no avatar, and the rows hold only views and dates.
  const channelId =
    image?.renderer_context?.command_context?.on_tap?.payload?.browseId;
  const channelName =
    image?.a11y_label?.replace(/^Go to channel\s+/i, "") || undefined;
  const channel: ChannelRef | undefined =
    collaborators[0] ??
    (channelId && channelName
      ? {
          channelId,
          name: channelName,
          avatars: toImages(image?.avatar?.image),
        }
      : undefined);
  const badges = lockupBadges(node);

  if (node.content_type === "PLAYLIST") {
    const count = badges.map((b) => parseCount(b)).find(Boolean);
    return {
      kind: "playlist",
      value: {
        playlistId: id,
        title,
        ...(collaborators.length > 1 ? { collaborators } : {}),
        thumbnails: toImages(lockupImage(node)),
        ...(count ? { videoCount: count.value } : {}),
        ...(channel ? { channel } : {}),
      },
    };
  }
  if (node.content_type !== "VIDEO") return undefined;

  const live = badges.some((b) => /^live$/i.test(b))
    ? "live"
    : badges.some((b) => /upcoming|premiere/i.test(b))
      ? "upcoming"
      : "none";
  const durationSec = parseClock(badges.find(isClock));
  // Row parts besides the credits: views ("122K views", "1.2K watching") and the date ("2 weeks ago").
  const credited = new Set([channelName, ...collaborators.map((c) => c.name)]);
  const rest = parts.filter((p) => !credited.has(p) && !/^and\s/.test(p));
  const viewsText = rest.find(
    (p) => /\bviews?\b/i.test(p) || /^[\d.,]+[KMB]?$/i.test(p),
  );
  const views = live === "live" ? undefined : parseCount(viewsText);
  const publishedText = rest.find((p) =>
    /\bago\b|^streamed|^premiered/i.test(p),
  );
  return {
    kind: "video",
    value: {
      videoId: id,
      title,
      ...(channel ? { channel } : {}),
      thumbnails: toImages(lockupImage(node)),
      ...(durationSec !== undefined && live === "none" ? { durationSec } : {}),
      ...(views ? { views } : {}),
      ...(publishedText ? { published: { text: publishedText } } : {}),
      live,
      isShort: badges.some((b) => /^shorts$/i.test(b)),
      ...(badges.some((b) => /members only/i.test(b))
        ? { membersOnly: true }
        : {}),
    },
  };
}

function lockupImage(
  node: YTNodes.LockupView,
): Array<{ url: string; width?: number; height?: number }> {
  const image = node.content_image as unknown as {
    image?: Array<{ url: string; width?: number; height?: number }>;
    primary_thumbnail?: {
      image?: Array<{ url: string; width?: number; height?: number }>;
    };
  } | null;
  return image?.image ?? image?.primary_thumbnail?.image ?? [];
}

/** Texts of the badges on a lockup's thumbnail ("15:16", "LIVE", "12 videos", "Members only"). */
function lockupBadges(node: YTNodes.LockupView): string[] {
  const out: string[] = [];
  const stack: unknown[] = [node.content_image];
  while (stack.length > 0) {
    const n = stack.pop() as { type?: string; text?: unknown } | null;
    if (!n || typeof n !== "object") continue;
    if (n.type === "ThumbnailBadgeView" && typeof n.text === "string")
      out.push(n.text);
    stack.push(...Object.values(n));
  }
  return out;
}

function fromChannel(
  node: YTNodes.GridChannel | YTNodes.Channel,
): ChannelSummary {
  // YouTube's search renderer puts the @handle where the subscriber count used to be.
  const texts =
    node instanceof YTNodes.Channel
      ? [node.subscriber_count?.toString(), node.video_count?.toString()]
      : [node.subscribers?.toString(), node.video_count?.toString()];
  const handle = texts.find((t) => t?.startsWith("@"));
  const subscribers = parseCount(texts.find((t) => t && /subscriber/i.test(t)));
  const description =
    node instanceof YTNodes.Channel
      ? node.description_snippet?.toString()
      : undefined;
  return {
    channelId: node.id,
    name: node.author.name,
    avatars: toImages(node.author.thumbnails),
    ...(handle ? { handle } : {}),
    ...(subscribers ? { subscribers } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * Every channel credited on a collaboration, from YouTube's "Collaborators"
 * dialog (the target of the byline or the avatar stack), in its order.
 * `avatars` are the stack's images, in the same order, when there are any.
 */
export function collaboratorsFrom(
  command: { payload?: unknown } | undefined,
  avatars: ReadonlyArray<
    ReadonlyArray<{ url: string; width?: number; height?: number }>
  > = [],
): ChannelRef[] {
  type Item = { listItemViewModel?: { title?: { content?: string } } };
  type Dialog = {
    panelLoadingStrategy?: {
      inlineContent?: {
        dialogViewModel?: {
          customContent?: { listViewModel?: { listItems?: Item[] } };
        };
      };
    };
  };
  const items =
    (command?.payload as Dialog | undefined)?.panelLoadingStrategy
      ?.inlineContent?.dialogViewModel?.customContent?.listViewModel
      ?.listItems ?? [];
  const out: ChannelRef[] = [];
  for (const [i, item] of items.entries()) {
    const name = item.listItemViewModel?.title?.content;
    const channelId = /"browseId":"(UC[A-Za-z0-9_-]{22})"/.exec(
      JSON.stringify(item),
    )?.[1];
    if (name && channelId)
      out.push({ channelId, name, avatars: toImages(avatars[i]) });
  }
  return out;
}

/** The token of a list's "load more" item, if it has one. */
export function findContinuation(root: unknown): string | undefined {
  const stack: unknown[] = [root];
  const visited = new Set<unknown>();
  let found: string | undefined;
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    // Older lists use continuationItemRenderer, newer ones continuationItemViewModel.
    if (
      node instanceof YTNodes.ContinuationItem ||
      node instanceof YTNodes.ContinuationItemView
    ) {
      const token = (node.endpoint?.payload as { token?: string } | undefined)
        ?.token;
      // The last one in document order is the list's own "load more".
      if (token) found = token;
      continue;
    }
    // Children reversed, so they come off the stack in document order.
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return found;
}
