import { describe, expect, it } from "vitest";
import { computeHealth } from "@/server/reports/compute-health";

const base = { attempts: 0, successes: 0, balance: 1000, lowBalanceThreshold: 100, isActive: true };

describe("computeHealth", () => {
  it("no attempts in 24h and healthy balance -> 100%, success rate null", () => {
    expect(computeHealth(base)).toEqual({ successRate: null, healthPercent: 100, label: "HEALTHY" });
  });
  it("success rate drives the score", () => {
    const r = computeHealth({ ...base, attempts: 10, successes: 7 });
    expect(r.successRate).toBe(70);
    expect(r.healthPercent).toBe(70);
    expect(r.label).toBe("DEGRADED");
  });
  it("low balance scales health down even with perfect success", () => {
    const r = computeHealth({ ...base, attempts: 10, successes: 10, balance: 25 });
    expect(r.healthPercent).toBe(25);
    expect(r.label).toBe("UNHEALTHY");
  });
  it("balance above the threshold does not boost the score", () => {
    expect(computeHealth({ ...base, attempts: 4, successes: 3, balance: 999999 }).healthPercent).toBe(75);
  });
  it("inactive route is 0%", () => {
    expect(computeHealth({ ...base, isActive: false }).healthPercent).toBe(0);
  });
  it("empty balance is 0%", () => {
    expect(computeHealth({ ...base, balance: 0 }).healthPercent).toBe(0);
  });
  it("labels: >=80 healthy, 50-79 degraded, <50 unhealthy", () => {
    expect(computeHealth({ ...base, attempts: 10, successes: 8 }).label).toBe("HEALTHY");
    expect(computeHealth({ ...base, attempts: 10, successes: 5 }).label).toBe("DEGRADED");
    expect(computeHealth({ ...base, attempts: 10, successes: 4 }).label).toBe("UNHEALTHY");
  });
});
