import { z } from "zod";
import { prisma } from "../db";
import { NotFoundError } from "../errors";

export async function getBalance(userId: string): Promise<number> {
  const w = await prisma.wallet.findUnique({ where: { userId } });
  if (!w) throw new NotFoundError("Wallet not found");
  return w.balance;
}

const topupSchema = z.object({ amount: z.number().int().min(1).max(1_000_000) });

/** Dev-only top-up. Atomic increment + ledger row in one transaction. */
export async function topup(userId: string, input: unknown): Promise<number> {
  const { amount } = topupSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE wallets SET balance = balance + ${amount}, updated_at = now()
      WHERE user_id = ${userId} RETURNING balance`;
    if (rows.length === 0) throw new NotFoundError("Wallet not found");
    await tx.creditTransaction.create({ data: { userId, type: "CREDIT", amount, balanceAfter: rows[0].balance } });
    return rows[0].balance;
  });
}
