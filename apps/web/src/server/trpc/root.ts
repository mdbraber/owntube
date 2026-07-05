import { router } from "@/server/trpc/init";
import { authRouter } from "@/server/trpc/routers/auth";
import { channelRouter } from "@/server/trpc/routers/channel";
import { feedRouter } from "@/server/trpc/routers/feed";
import { historyRouter } from "@/server/trpc/routers/history";
import { interactionsRouter } from "@/server/trpc/routers/interactions";
import { playlistsRouter } from "@/server/trpc/routers/playlists";
import { queueRouter } from "@/server/trpc/routers/queue";
import { searchRouter } from "@/server/trpc/routers/search";
import { settingsRouter } from "@/server/trpc/routers/settings";
import { shortsRouter } from "@/server/trpc/routers/shorts";
import { sponsorblockRouter } from "@/server/trpc/routers/sponsorblock";
import { statsRouter } from "@/server/trpc/routers/stats";
import { subscriptionsRouter } from "@/server/trpc/routers/subscriptions";
import { takeoutRouter } from "@/server/trpc/routers/takeout";
import { tasteRouter } from "@/server/trpc/routers/taste";
import { trendingRouter } from "@/server/trpc/routers/trending";
import { videoRouter } from "@/server/trpc/routers/video";

export const appRouter = router({
  auth: authRouter,
  channel: channelRouter,
  feed: feedRouter,
  history: historyRouter,
  interactions: interactionsRouter,
  playlists: playlistsRouter,
  queue: queueRouter,
  search: searchRouter,
  shorts: shortsRouter,
  settings: settingsRouter,
  sponsorblock: sponsorblockRouter,
  stats: statsRouter,
  subscriptions: subscriptionsRouter,
  takeout: takeoutRouter,
  taste: tasteRouter,
  trending: trendingRouter,
  video: videoRouter,
});

export type AppRouter = typeof appRouter;
