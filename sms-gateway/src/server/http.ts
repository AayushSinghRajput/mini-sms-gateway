import { ZodError } from "zod";
import { AppError, UnauthorizedError, ValidationError } from "./errors";
import { verifyToken } from "./auth/jwt";

// Framework-agnostic HTTP helpers (standard Web Request/Response only, no next/* imports).

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const e = new ValidationError(details[0] ? `${details[0].path || "body"}: ${details[0].message}` : "Invalid input", details);
    return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
  }
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }, err.status, err.headers);
  }
  console.error("Unexpected error:", err); // log server-side only, never leak internals
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } }, 500);
}

export function withErrorHandling(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function requireUser(req: Request): Promise<{ userId: string }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new UnauthorizedError();
  try {
    return { userId: await verifyToken(match[1]) };
  } catch {
    throw new UnauthorizedError();
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
