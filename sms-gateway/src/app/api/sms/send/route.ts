import { json, readJson, requireUser, withErrorHandling } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit/rate-limit.service";
import { sendSms } from "@/server/sms/send.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // seconds: a 100-recipient request needs a few seconds of (mock) provider latency

export const POST = withErrorHandling(async (req) => {
  const { userId } = await requireUser(req);
  await enforceRateLimit(userId); // before any validation work or debit: a 429 never touches credits
  return json(await sendSms(userId, await readJson(req)));
});
