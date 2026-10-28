import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { EmailTakenError, UnauthorizedError } from "../errors";
import { hashPassword, verifyPassword } from "./password";
import { signToken } from "./jwt";

const emailField = z.string().trim().toLowerCase().email().max(254);

const registerSchema = z.object({ email: emailField, password: z.string().min(8, "must be at least 8 characters").max(128) });
const loginSchema = z.object({ email: emailField, password: z.string().min(1).max(128) });

export async function register(input: unknown) {
  const { email, password } = registerSchema.parse(input);
  const passwordHash = await hashPassword(password);
  const start = config.STARTING_CREDITS;
  try {
    // User + wallet + ledger row are created atomically: the ledger always explains the balance.
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, passwordHash } });
      await tx.wallet.create({ data: { userId: u.id, balance: start } });
      if (start > 0) {
        await tx.creditTransaction.create({ data: { userId: u.id, type: "CREDIT", amount: start, balanceAfter: start } });
      }
      return u;
    });
    return { token: await signToken(user.id), user: { id: user.id, email: user.email } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new EmailTakenError();
    throw err;
  }
}

export async function login(input: unknown) {
  const { email, password } = loginSchema.parse(input);
  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic error for unknown email and wrong password: do not reveal which accounts exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthorizedError("Invalid email or password");
  }
  return { token: await signToken(user.id), user: { id: user.id, email: user.email } };
}
