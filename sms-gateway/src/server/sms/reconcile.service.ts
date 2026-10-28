import { prisma } from "../db";
import { config } from "../config";
import { processMessage } from "./process.service";
import { purgeOldRateLimits } from "../rate-limit/rate-limit.service";

/**
 * Crash recovery, one pass. If the process dies after the credits were debited but before a message was
 * delivered, the message stays PENDING. This finds stale PENDING messages, claims them with a guarded UPDATE
 * (so concurrent reconcilers never process the same message) and finishes them: SENT via failover, or refunded.
 *
 * Used by the long-running script (npm run reconcile) and by the cron endpoint (GET /api/cron/reconcile).
 */
export async function reconcileOnce(): Promise<number> {
  const stale = config.PENDING_STALE_SECONDS;
  const candidates = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM messages
    WHERE status = 'PENDING' AND updated_at < now() - make_interval(secs => ${stale})
    ORDER BY updated_at ASC LIMIT 200`;

  let recovered = 0;
  for (const { id } of candidates) {
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE messages SET updated_at = now()
      WHERE id = ${id} AND status = 'PENDING' AND updated_at < now() - make_interval(secs => ${stale})
      RETURNING id`;
    if (claimed.length === 0) continue;
    try {
      const outcome = await processMessage(id);
      console.log(`[reconcile] ${id} -> ${outcome.status}${"provider" in outcome ? ` via ${outcome.provider}` : ""}`);
      recovered++;
    } catch (err) {
      console.error(`[reconcile] ${id} failed, will retry later`, err);
    }
  }
  const purged = await purgeOldRateLimits();
  if (purged > 0) console.log(`[reconcile] purged ${purged} old rate-limit row(s)`);
  return recovered;
}
