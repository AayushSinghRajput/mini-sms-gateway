import { describe, expect, it, vi } from "vitest";

// The limiter module imports the DB client; the pure parts under test never touch it.
vi.mock("@/server/db", () => ({ prisma: {} }));

import { isOverLimit } from "@/server/rate-limit/rate-limit.service";
import { RateLimitedError } from "@/server/errors";
import { errorResponse } from "@/server/http";

describe("isOverLimit", () => {
  it("allows up to and including the limit, blocks after", () => {
    expect(isOverLimit(1, 60)).toBe(false);
    expect(isOverLimit(60, 60)).toBe(false);
    expect(isOverLimit(61, 60)).toBe(true);
  });
});

describe("429 mapping", () => {
  it("returns 429 RATE_LIMITED with a Retry-After header", async () => {
    const res = errorResponse(new RateLimitedError(60, 17));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.details).toEqual({ limit: 60, retryAfterSeconds: 17 });
  });
  it("Retry-After is at least 1 second", () => {
    expect(errorResponse(new RateLimitedError(60, 0)).headers.get("Retry-After")).toBe("1");
  });
});
