import { json, requireUser, withErrorHandling } from "@/server/http";
import { getRoutesHealth } from "@/server/reports/health.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req) => {
  await requireUser(req);
  return json({ routes: await getRoutesHealth() });
});
