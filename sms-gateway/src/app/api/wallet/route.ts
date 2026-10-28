import { json, requireUser, withErrorHandling } from "@/server/http";
import { getBalance } from "@/server/wallet/wallet.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req) => {
  const { userId } = await requireUser(req);
  return json({ balance: await getBalance(userId) });
});
