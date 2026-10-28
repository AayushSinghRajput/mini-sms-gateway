import { json, readJson, requireUser, withErrorHandling } from "@/server/http";
import { config } from "@/server/config";
import { NotFoundError } from "@/server/errors";
import { topup } from "@/server/wallet/wallet.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dev-only: disabled (404) unless ALLOW_DEV_TOPUP=true.
export const POST = withErrorHandling(async (req) => {
  if (!config.ALLOW_DEV_TOPUP) throw new NotFoundError();
  const { userId } = await requireUser(req);
  return json({ balance: await topup(userId, await readJson(req)) });
});
