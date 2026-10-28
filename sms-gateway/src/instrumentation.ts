// Fail fast at server start if essential env vars are missing.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertConfig } = await import("./server/config");
    assertConfig();
  }
}
