import { router } from "@/server/trpc/init";
import { apiTokensRouter } from "@/server/trpc/routers/api-tokens";
import { authRouter } from "@/server/trpc/routers/auth";
import { channelRouter } from "@/server/trpc/routers/channel";
import { channelTagsRouter } from "@/server/trpc/routers/channel-tags";
import { favoritesRouter } from "@/server/trpc/routers/favorites";
import { feedRouter } from "@/server/trpc/routers/feed";
import { historyRouter } from "@/server/trpc/routers/history";
import { interactionsRouter } from "@/server/trpc/routers/interactions";
import { liveRouter } from "@/server/trpc/routers/live";
import { playlistsRouter } from "@/server/trpc/routers/playlists";
import { queueRouter } from "@/server/trpc/routers/queue";
import { remoteRouter } from "@/server/trpc/routers/remote";
import { searchRouter } from "@/server/trpc/routers/search";
import { settingsRouter } from "@/server/trpc/routers/settings";
import { shortsRouter } from "@/server/trpc/routers/shorts";
import { sponsorblockRouter } from "@/server/trpc/routers/sponsorblock";
import { statsRouter } from "@/server/trpc/routers/stats";
import { subscriptionsRouter } from "@/server/trpc/routers/subscriptions";
import { takeoutRouter } from "@/server/trpc/routers/takeout";
import { tasteRouter } from "@/server/trpc/routers/taste";
import { tvRemoteRouter } from "@/server/trpc/routers/tv-remote";
import { videoRouter } from "@/server/trpc/routers/video";

export const appRouter = router({
  apiTokens: apiTokensRouter,
  auth: authRouter,
  channel: channelRouter,
  channelTags: channelTagsRouter,
  favorites: favoritesRouter,
  feed: feedRouter,
  history: historyRouter,
  interactions: interactionsRouter,
  playlists: playlistsRouter,
  queue: queueRouter,
  remote: remoteRouter,
  tvRemote: tvRemoteRouter,
  search: searchRouter,
  shorts: shortsRouter,
  settings: settingsRouter,
  sponsorblock: sponsorblockRouter,
  stats: statsRouter,
  subscriptions: subscriptionsRouter,
  takeout: takeoutRouter,
  taste: tasteRouter,
  live: liveRouter,
  video: videoRouter,
});

export type AppRouter = typeof appRouter;
