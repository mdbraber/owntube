import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { stripGoogleImageUrls } from "@/lib/youtube-image-via-instance";
import { apiTokenAllows } from "@/server/api-token";
import { UpstreamLiveUpcomingError } from "@/server/errors/upstream-live-upcoming";
import type { TRPCContext } from "@/server/trpc/context";

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // An upcoming stream's start time, so a client (the TV) can say when it
    // begins rather than only that it can't play yet.
    const cause = error.cause;
    return cause instanceof UpstreamLiveUpcomingError
      ? {
          ...shape,
          data: {
            ...shape.data,
            premiereTimestamp: cause.premiereTimestamp ?? null,
          },
        }
      : shape;
  },
});

export const router = t.router;

/**
 * Browser responses carry no Google image URLs: they are moved onto the
 * instance (`stripGoogleImageUrls`), so a page's data and source name none and
 * nothing in the browser can load from Google by mistake. Native clients keep
 * upstream URLs: the TV resizes Google avatars itself, and installed TV apps
 * can't load relative paths.
 */
const browserSafeImages = t.middleware(async ({ ctx, next }) => {
  const result = await next();
  if (!result.ok || ctx.browser !== true) return result;
  return { ...result, data: stripGoogleImageUrls(result.data) };
});

export const publicProcedure = t.procedure.use(browserSafeImages);
export const protectedProcedure = publicProcedure.use(({ ctx, path, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    });
  }
  if (ctx.apiToken && !apiTokenAllows(ctx.apiToken.scopes, path)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `This API token's scopes don't allow ${path}.`,
    });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
