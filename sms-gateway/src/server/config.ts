// Typed, lazy access to environment variables with defaults.
// Getters (not constants) so pure modules/tests can import this without needing a full env.

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got "${raw}"`);
  return n;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  get DATABASE_URL() { return required("DATABASE_URL"); },
  get JWT_SECRET() { return required("JWT_SECRET"); },
  get JWT_EXPIRES_IN() { return process.env.JWT_EXPIRES_IN || "24h"; },
  get STARTING_CREDITS() { return num("STARTING_CREDITS", 100); },
  get ALLOW_DEV_TOPUP() { return process.env.ALLOW_DEV_TOPUP === "true"; },
  get MAX_RECIPIENTS() { return num("MAX_RECIPIENTS", 100); },
  get MAX_PARTS_PER_MESSAGE() { return num("MAX_PARTS_PER_MESSAGE", 10); },
  get LOW_BALANCE_THRESHOLD() { return num("LOW_BALANCE_THRESHOLD", 100); },
  get PENDING_STALE_SECONDS() { return num("PENDING_STALE_SECONDS", 120); },
  get RECONCILE_INTERVAL_MS() { return num("RECONCILE_INTERVAL_MS", 30000); },
  get MOCK_LATENCY_MS() { return num("MOCK_LATENCY_MS", 50); },
  get SEND_CONCURRENCY() { return Math.max(1, num("SEND_CONCURRENCY", 10)); },
  get RATE_LIMIT_PER_MINUTE() { return num("RATE_LIMIT_PER_MINUTE", 60); },
  /** Demo-only: lets any logged-in user change route failure rate/balance (POST /api/demo/routes). Keep false in production. */
  get DEMO_CONTROLS() { return process.env.DEMO_CONTROLS === "true"; },
  /** Shared secret for the cron endpoint (Vercel Cron sends it as `Authorization: Bearer <secret>`). */
  get CRON_SECRET() { return process.env.CRON_SECRET || ""; },
};

/** Fail fast at startup if the essentials are missing. */
export function assertConfig(): void {
  void config.DATABASE_URL;
  void config.JWT_SECRET;
}
