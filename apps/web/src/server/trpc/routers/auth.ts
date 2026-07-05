import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { verifyCredentials } from "@/server/credentials";
import { users } from "@/server/db/schema";
import {
  approveDevicePairing,
  normalizeDevicePairingUserCode,
  pollDevicePairing,
  startDevicePairing,
} from "@/server/device-pairing";
import { createDeviceToken } from "@/server/device-token";
import {
  protectedProcedure,
  publicProcedure,
  router,
} from "@/server/trpc/init";

const credentialsInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const registerInputSchema = credentialsInputSchema;

const devicePairingUserCodeSchema = z.object({
  userCode: z
    .string()
    .min(8)
    .max(16)
    .transform((value) => normalizeDevicePairingUserCode(value))
    .refine((value) => value.length > 0, "Invalid pairing code."),
});

const devicePairingPollSchema = devicePairingUserCodeSchema.extend({
  deviceCode: z.string().min(32).max(128),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const authRouter = router({
  session: publicProcedure.query(({ ctx }) => ({
    authed: Boolean(ctx.userId),
  })),
  register: publicProcedure
    .input(registerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      const existing = ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)
        .all()[0];
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account already exists for this email.",
        });
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      const ts = nowUnix();
      const created = ctx.db
        .insert(users)
        .values({
          email,
          passwordHash,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning({ id: users.id, email: users.email })
        .get();
      return created;
    }),

  // TV/native login: same credentials check as the web cookie flow, but returns
  // an encrypted JWT for the client to send as `Authorization: Bearer <token>`.
  deviceLogin: publicProcedure
    .input(credentialsInputSchema)
    .mutation(async ({ input }) => {
      const user = await verifyCredentials(input.email, input.password);
      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid email or password.",
        });
      }
      const token = await createDeviceToken(user.id);
      return { token, user };
    }),

  startDevicePairing: publicProcedure.mutation(() => startDevicePairing()),

  approveDevicePairing: protectedProcedure
    .input(devicePairingUserCodeSchema)
    .mutation(({ ctx, input }) =>
      approveDevicePairing(input.userCode, ctx.userId),
    ),

  pollDevicePairing: publicProcedure
    .input(devicePairingPollSchema)
    .query(({ input }) => pollDevicePairing(input)),
});
