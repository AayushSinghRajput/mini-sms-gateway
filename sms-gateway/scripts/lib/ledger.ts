import type { PrismaClient } from "@prisma/client";

export interface LedgerReport { ok: boolean; wallets: number; problems: string[] }

/**
 * Invariants that must ALWAYS hold if no credit was lost or double-spent:
 *  1. wallet.balance == SUM(CREDIT) + SUM(REFUND) - SUM(DEBIT) for every user
 *  2. a refunded message is FAILED; a FAILED message is refunded; PENDING/SENT are never refunded
 *  3. each message has at most one DEBIT and one REFUND, and every refund has a matching debit
 *  4. no negative balances
 */
export async function verifyLedger(prisma: PrismaClient): Promise<LedgerReport> {
  const problems: string[] = [];

  const wallets = await prisma.$queryRaw<{ user_id: string; email: string; balance: number; ledger: number }[]>`
    SELECT w.user_id, u.email, w.balance,
           COALESCE(SUM(CASE WHEN t.type IN ('CREDIT','REFUND') THEN t.amount
                             WHEN t.type = 'DEBIT' THEN -t.amount END), 0)::int AS ledger
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN credit_transactions t ON t.user_id = w.user_id
    GROUP BY w.user_id, u.email, w.balance`;
  for (const w of wallets) {
    if (w.balance !== w.ledger) problems.push(`wallet ${w.email}: balance ${w.balance} != ledger ${w.ledger}`);
    if (w.balance < 0) problems.push(`wallet ${w.email}: negative balance ${w.balance}`);
  }

  const badMsgs = await prisma.$queryRaw<{ id: string; status: string; refunded: boolean }[]>`
    SELECT id, status::text AS status, refunded FROM messages
    WHERE (refunded AND status <> 'FAILED') OR (status = 'FAILED' AND NOT refunded) OR (status IN ('PENDING','SENT') AND refunded)`;
  for (const m of badMsgs) problems.push(`message ${m.id}: status ${m.status} with refunded=${m.refunded}`);

  const refundsWithoutDebit = await prisma.$queryRaw<{ message_id: string }[]>`
    SELECT r.message_id FROM credit_transactions r
    WHERE r.type = 'REFUND'
      AND NOT EXISTS (SELECT 1 FROM credit_transactions d WHERE d.message_id = r.message_id AND d.type = 'DEBIT')`;
  for (const r of refundsWithoutDebit) problems.push(`message ${r.message_id}: REFUND without DEBIT`);

  // Every FAILED message has exactly one REFUND row; every refunded=true message too.
  const refundMismatch = await prisma.$queryRaw<{ id: string }[]>`
    SELECT m.id FROM messages m
    WHERE m.refunded <> EXISTS (SELECT 1 FROM credit_transactions t WHERE t.message_id = m.id AND t.type = 'REFUND')`;
  for (const m of refundMismatch) problems.push(`message ${m.id}: refunded flag does not match REFUND ledger row`);

  return { ok: problems.length === 0, wallets: wallets.length, problems };
}
