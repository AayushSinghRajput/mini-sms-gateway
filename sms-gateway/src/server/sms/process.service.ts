import { prisma } from "../db";
import { createProvider } from "../providers/registry";
import type { ProviderRow } from "../providers/types";
import { runFailover, type FailoverRepo, type ProcessOutcome } from "./failover";
import { refundMessage } from "./refund.service";

/** Real (Postgres) implementation of the failover repo. Every write is a guarded, atomic statement. */
const prismaRepo: FailoverRepo = {
  async getMessage(id) {
    const m = await prisma.message.findUnique({ where: { id } });
    return m ? { id: m.id, status: m.status, parts: m.parts, to: m.to, body: m.body } : null;
  },

  async listActiveProviders(): Promise<ProviderRow[]> {
    return prisma.provider.findMany({ where: { isActive: true }, orderBy: { priority: "asc" } });
  },

  async reserveProviderBalance(providerId, parts) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE providers SET balance = balance - ${parts}
      WHERE id = ${providerId} AND balance >= ${parts} AND is_active = true
      RETURNING id`;
    return rows.length > 0;
  },

  async releaseProviderBalance(providerId, parts) {
    await prisma.$executeRaw`UPDATE providers SET balance = balance + ${parts} WHERE id = ${providerId}`;
  },

  async recordAttempt(messageId, providerId, success, error) {
    await prisma.sendAttempt.create({ data: { messageId, providerId, success, error: error ?? null } });
  },

  async markSent(messageId, providerId) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE messages
      SET status = 'SENT', provider_id = ${providerId}, sent_at = now(), updated_at = now()
      WHERE id = ${messageId} AND status = 'PENDING'
      RETURNING id`;
    return rows.length > 0;
  },

  async refund(messageId, reason) {
    await refundMessage(messageId, reason);
  },
};

/** Deliver one PENDING message (failover + finalise or refund). Idempotent; later callable from a queue worker. */
export function processMessage(messageId: string): Promise<ProcessOutcome> {
  return runFailover(prismaRepo, createProvider, messageId);
}
