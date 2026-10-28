import "dotenv/config";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { reconcileOnce } from "@/server/sms/reconcile.service";

/**
 * Long-running crash-recovery loop.
 *   npm run reconcile            # loop forever
 *   npm run reconcile -- --once  # one pass, then exit
 * (On Vercel the same logic runs from the cron endpoint instead: GET /api/cron/reconcile.)
 */
async function main() {
  const once = process.argv.includes("--once");
  console.log(`[reconcile] started (stale after ${config.PENDING_STALE_SECONDS}s${once ? ", single pass" : `, every ${config.RECONCILE_INTERVAL_MS}ms`})`);
  do {
    try {
      const n = await reconcileOnce();
      if (once) console.log(`[reconcile] recovered ${n} message(s)`);
    } catch (err) {
      console.error("[reconcile] pass failed", err);
    }
    if (!once) await new Promise((r) => setTimeout(r, config.RECONCILE_INTERVAL_MS));
  } while (!once);
  await prisma.$disconnect();
}

main();
