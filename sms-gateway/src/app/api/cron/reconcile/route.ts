import { json, withErrorHandling } from "@/server/http";
import { config } from "@/server/config";
import { NotFoundError, UnauthorizedError } from "@/server/errors";
import { reconcileOnce } from "@/server/sms/reconcile.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Crash recovery for serverless hosting (no long-running process). Vercel Cron calls this with
// `Authorization: Bearer $CRON_SECRET`. Disabled (404) when CRON_SECRET is not configured.
export const GET = withErrorHandling(async (req) => {
  if (!config.CRON_SECRET) throw new NotFoundError();
  if (req.headers.get("authorization") !== `Bearer ${config.CRON_SECRET}`) throw new UnauthorizedError("Invalid cron secret");
  return json({ recovered: await reconcileOnce() });
});
