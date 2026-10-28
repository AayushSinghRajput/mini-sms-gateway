import { prisma } from "../db";
import { config } from "../config";
import { RateLimitedError } from "../errors";

/** Pure decision: is this request (the `count`-th in the window) over the limit? */
export function isOverLimit(count: number, limit: number): boolean {
  return count > limit;
}

/**
 * Per-user fixed-window limiter backed by Postgres.
 * One atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so parallel requests cannot under-count.
 */
export async function enforceRateLimit(userId: string): Promise<void> {
  const limit = config.RATE_LIMIT_PER_MINUTE;
  const rows = await prisma.$queryRaw<{ count: number; retry_after: number }[]>`
    INSERT INTO rate_limits (user_id, window_start, count)
    VALUES (${userId}, date_trunc('minute', now()), 1)
    ON CONFLICT (user_id, window_start)
    DO UPDATE SET count = rate_limits.count + 1
    RETURNING count,
      CEIL(EXTRACT(EPOCH FROM (window_start + interval '1 minute' - now())))::int AS retry_after`;
  if (isOverLimit(rows[0].count, limit)) throw new RateLimitedError(limit, rows[0].retry_after);
}

/** Housekeeping used by the reconciler. */
export async function purgeOldRateLimits(): Promise<number> {
  return prisma.$executeRaw`DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'`;
}
