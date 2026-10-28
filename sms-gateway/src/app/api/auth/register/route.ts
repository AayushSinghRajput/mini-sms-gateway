import { json, readJson, withErrorHandling } from "@/server/http";
import { register } from "@/server/auth/auth.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (req) => json(await register(await readJson(req)), 201));
