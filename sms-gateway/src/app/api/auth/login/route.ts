import { json, readJson, withErrorHandling } from "@/server/http";
import { login } from "@/server/auth/auth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req) => json(await login(await readJson(req))));
