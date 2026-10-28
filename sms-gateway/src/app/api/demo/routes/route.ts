import { json, readJson, requireUser, withErrorHandling } from "@/server/http";
import { config } from "@/server/config";
import { NotFoundError } from "@/server/errors";
import { updateRoutes } from "@/server/providers/demo.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DEMO ONLY. Disabled (404) unless DEMO_CONTROLS=true. Lets a logged-in user set a mock route's failure rate,
// balance or active flag so that failover and refunds can be demonstrated on a deployed instance.
// Equivalent of `npm run route:set`. Never enable in a real production environment.
export const POST = withErrorHandling(async (req) => {
  if (!config.DEMO_CONTROLS) throw new NotFoundError();
  await requireUser(req);
  return json({ routes: await updateRoutes(await readJson(req)) });
});
