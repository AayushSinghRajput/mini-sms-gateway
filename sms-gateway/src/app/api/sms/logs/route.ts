import { json, requireUser, withErrorHandling } from "@/server/http";
import { getLogs } from "@/server/sms/logs.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req) => {
  const { userId } = await requireUser(req);
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return json(await getLogs(userId, params));
});
