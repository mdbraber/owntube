import { TRPCError } from "@trpc/server";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/server/db/schema";
import { publicProcedure, router } from "@/server/trpc/init";

const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export const authRouter = router({
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
});
