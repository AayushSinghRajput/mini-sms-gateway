import { describe, expect, it } from "vitest";
import { runFailover, type FailoverRepo } from "@/server/sms/failover";
import type { ProviderRow, SmsProvider } from "@/server/providers/types";

function row(name: string, priority: number, balance = 1000): ProviderRow {
  return { id: name, name, priority, balance, failureRate: 0, isActive: true };
}

/** In-memory fake of the DB side. */
function makeRepo(providers: ProviderRow[], status = "PENDING", parts = 1) {
  const balances = new Map(providers.map((p) => [p.id, p.balance]));
  const state = { status, attempts: [] as string[], refunds: 0, sentBy: null as string | null, markSentResult: true };
  const repo: FailoverRepo = {
    async getMessage(id) { return { id, status: state.status, parts, to: "9841234567", body: "hi" }; },
    async listActiveProviders() { return [...providers].sort((a, b) => a.priority - b.priority); },
    async reserveProviderBalance(id, p) {
      const b = balances.get(id) ?? 0;
      if (b < p) return false;
      balances.set(id, b - p);
      return true;
    },
    async releaseProviderBalance(id, p) { balances.set(id, (balances.get(id) ?? 0) + p); },
    async recordAttempt(_m, providerId, success) { state.attempts.push(`${providerId}:${success ? "ok" : "fail"}`); },
    async markSent(_m, providerId) {
      if (!state.markSentResult) return false;
      state.status = "SENT"; state.sentBy = providerId; return true;
    },
    async refund() { state.refunds++; state.status = "FAILED"; },
  };
  return { repo, state, balances };
}

const fake = (succeeds: Record<string, boolean>) => (r: ProviderRow): SmsProvider => ({
  name: r.name,
  getBalance: async () => 0,
  send: async () => (succeeds[r.name] ? { success: true } : { success: false, error: "boom" }),
});

describe("runFailover", () => {
  it("uses the top-priority provider when it succeeds", async () => {
    const { repo, state } = makeRepo([row("A", 1), row("B", 2)]);
    const out = await runFailover(repo, fake({ A: true, B: true }), "m1");
    expect(out).toEqual({ status: "SENT", provider: "A" });
    expect(state.attempts).toEqual(["A:ok"]);
    expect(state.refunds).toBe(0);
  });

  it("fails over to the next provider when the first fails", async () => {
    const { repo, state, balances } = makeRepo([row("A", 1), row("B", 2)]);
    const out = await runFailover(repo, fake({ A: false, B: true }), "m1");
    expect(out).toEqual({ status: "SENT", provider: "B" });
    expect(state.attempts).toEqual(["A:fail", "B:ok"]);
    expect(balances.get("A")).toBe(1000); // reservation on the failed route was given back
    expect(balances.get("B")).toBe(999); // successful route is charged
  });

  it("respects priority order regardless of list order", async () => {
    const { repo, state } = makeRepo([row("C", 3), row("A", 1), row("B", 2)]);
    await runFailover(repo, fake({ A: false, B: false, C: true }), "m1");
    expect(state.attempts).toEqual(["A:fail", "B:fail", "C:ok"]);
  });

  it("refunds exactly once when every route fails", async () => {
    const { repo, state } = makeRepo([row("A", 1), row("B", 2), row("C", 3)]);
    const out = await runFailover(repo, fake({}), "m1");
    expect(out).toEqual({ status: "FAILED" });
    expect(state.attempts).toEqual(["A:fail", "B:fail", "C:fail"]);
    expect(state.refunds).toBe(1);
  });

  it("skips a provider without enough balance (no attempt recorded)", async () => {
    const { repo, state } = makeRepo([row("A", 1, 0), row("B", 2)], "PENDING", 2);
    const out = await runFailover(repo, fake({ A: true, B: true }), "m1");
    expect(out).toEqual({ status: "SENT", provider: "B" });
    expect(state.attempts).toEqual(["B:ok"]);
  });

  it("refunds when all providers are out of balance", async () => {
    const { repo, state } = makeRepo([row("A", 1, 0), row("B", 2, 0)]);
    const out = await runFailover(repo, fake({ A: true, B: true }), "m1");
    expect(out).toEqual({ status: "FAILED" });
    expect(state.attempts).toEqual([]);
    expect(state.refunds).toBe(1);
  });

  it("treats a provider that throws as a failure and moves on", async () => {
    const { repo, state } = makeRepo([row("A", 1), row("B", 2)]);
    const make = (r: ProviderRow): SmsProvider => ({
      name: r.name, getBalance: async () => 0,
      send: async () => { if (r.name === "A") throw new Error("network down"); return { success: true }; },
    });
    const out = await runFailover(repo, make, "m1");
    expect(out).toEqual({ status: "SENT", provider: "B" });
    expect(state.attempts).toEqual(["A:fail", "B:ok"]);
  });

  it("ignores messages that are not PENDING (idempotent)", async () => {
    const { repo, state } = makeRepo([row("A", 1)], "SENT");
    expect(await runFailover(repo, fake({ A: true }), "m1")).toEqual({ status: "SKIPPED" });
    expect(state.attempts).toEqual([]);
    expect(state.refunds).toBe(0);
  });

  it("gives the reservation back if another worker already finalised the message", async () => {
    const { repo, state, balances } = makeRepo([row("A", 1)]);
    state.markSentResult = false;
    expect(await runFailover(repo, fake({ A: true }), "m1")).toEqual({ status: "SKIPPED" });
    expect(balances.get("A")).toBe(1000);
    expect(state.refunds).toBe(0);
  });
});
