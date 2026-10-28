import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { InsufficientCreditsError, InvalidNumbersError, type InvalidNumber } from "../errors";
import { getBalance } from "../wallet/wallet.service";
import { normalizeNepaliMobile } from "./phone";
import { countSegments } from "./segments";
import { processMessage } from "./process.service";

const INVALID_REASON = "Not a valid Nepali mobile number (10 digits starting with 97 or 98, optional +977/977 prefix)";

/**
 * POST /sms/send core:
 *  validate -> normalise -> de-duplicate -> price -> ATOMIC debit + create messages -> deliver with failover.
 */
export async function sendSms(userId: string, rawBody: unknown) {
  const body = z
    .object({
      to: z.array(z.string()).min(1, "must contain at least one number").max(config.MAX_RECIPIENTS, `must contain at most ${config.MAX_RECIPIENTS} numbers`),
      message: z.string(),
    })
    .parse(rawBody);

  // 1. Message size and price
  const seg = countSegments(body.message, config.MAX_PARTS_PER_MESSAGE);

  // 2. Numbers: normalise all, reject the whole request if any is invalid (nothing sent, nothing charged)
  const invalid: InvalidNumber[] = [];
  const numbers: string[] = [];
  const seen = new Set<string>();
  let duplicatesRemoved = 0;
  for (const input of body.to) {
    const n = normalizeNepaliMobile(input);
    if (!n) invalid.push({ input, reason: INVALID_REASON });
    else if (seen.has(n)) duplicatesRemoved++;
    else { seen.add(n); numbers.push(n); }
  }
  if (invalid.length > 0) throw new InvalidNumbersError(invalid);

  const costPerMessage = seg.parts; // 1 credit per SMS part
  const totalCost = costPerMessage * numbers.length;
  const requestId = randomUUID();
  const messageIds = numbers.map(() => randomUUID());

  // 3. THE critical section. One transaction:
  //    a single conditional UPDATE takes the credits (row lock serialises parallel requests, the
  //    `balance >= cost` condition makes overspending impossible), then messages + ledger rows are created.
  try {
    await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ balance: number }[]>`
          UPDATE wallets
          SET balance = balance - ${totalCost}, updated_at = now()
          WHERE user_id = ${userId} AND balance >= ${totalCost}
          RETURNING balance`;
        if (rows.length === 0) throw new InsufficientCreditsError(totalCost, 0);

        const balanceBefore = rows[0].balance + totalCost;
        await tx.message.createMany({
          data: numbers.map((to, i) => ({
            id: messageIds[i], userId, requestId, to, body: body.message,
            encoding: seg.encoding, parts: seg.parts, cost: costPerMessage,
          })),
        });
        await tx.creditTransaction.createMany({
          data: numbers.map((_, i) => ({
            userId, messageId: messageIds[i], type: "DEBIT" as const, amount: costPerMessage,
            balanceAfter: balanceBefore - (i + 1) * costPerMessage,
          })),
        });
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      throw new InsufficientCreditsError(totalCost, await getBalance(userId)); // informational read, after the fact
    }
    throw err;
  }

  // 4. Deliver (bounded concurrency). A failure here leaves the message PENDING; the reconciler recovers it.
  const concurrency = config.SEND_CONCURRENCY;
  for (let i = 0; i < messageIds.length; i += concurrency) {
    await Promise.all(
      messageIds.slice(i, i + concurrency).map((id) =>
        processMessage(id).catch((err) => console.error(`processMessage(${id}) failed; reconciler will retry`, err)),
      ),
    );
  }

  // 5. Report final state per recipient
  const messages = await prisma.message.findMany({
    where: { requestId },
    include: { provider: true, attempts: { include: { provider: true }, orderBy: { createdAt: "asc" } } },
  });
  const order = new Map(numbers.map((n, i) => [n, i]));
  messages.sort((a, b) => (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0));

  const results = messages.map((m) => ({
    messageId: m.id,
    to: m.to,
    status: m.status,
    provider: m.provider?.name ?? null,
    attempts: m.attempts.map((a) => `${a.provider.name}:${a.success ? "sent" : "failed"}`),
    cost: m.cost,
    refunded: m.refunded,
  }));

  return {
    requestId,
    encoding: seg.encoding,
    partsPerMessage: seg.parts,
    costPerMessage,
    totalCost,
    summary: {
      total: results.length,
      sent: results.filter((r) => r.status === "SENT").length,
      failed: results.filter((r) => r.status === "FAILED").length,
      pending: results.filter((r) => r.status === "PENDING").length,
      refundedCredits: messages.filter((m) => m.refunded).reduce((sum, m) => sum + m.cost, 0),
    },
    duplicatesRemoved,
    balance: await getBalance(userId),
    results,
  };
}
