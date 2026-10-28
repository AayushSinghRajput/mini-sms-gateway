import { prisma } from "../db";

/**
 * Refund a message that could not be delivered, EXACTLY ONCE.
 *
 * The UPDATE ... WHERE status = 'PENDING' AND refunded = false is the guard: only one caller can ever
 * win that transition, so only one caller credits the wallet. The unique (message_id, type) index on
 * credit_transactions backs this up at the database level.
 */
export async function refundMessage(messageId: string, reason: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ user_id: string; cost: number }[]>`
      UPDATE messages
      SET status = 'FAILED', refunded = true, failure_reason = ${reason}, updated_at = now()
      WHERE id = ${messageId} AND status = 'PENDING' AND refunded = false
      RETURNING user_id, cost`;
    if (rows.length === 0) return false; // already sent / already refunded: nothing to do

    const wallet = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE wallets SET balance = balance + ${rows[0].cost}, updated_at = now()
      WHERE user_id = ${rows[0].user_id} RETURNING balance`;

    await tx.creditTransaction.create({
      data: { userId: rows[0].user_id, messageId, type: "REFUND", amount: rows[0].cost, balanceAfter: wallet[0].balance },
    });
    return true;
  });
}
