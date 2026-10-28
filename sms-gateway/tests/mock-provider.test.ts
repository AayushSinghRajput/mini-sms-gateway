import { describe, expect, it } from "vitest";
import { MockProvider } from "@/server/providers/mock-provider";

const noSleep = async () => {};

describe("MockProvider", () => {
  it("fails when random < failureRate", async () => {
    const p = new MockProvider({ name: "R", failureRate: 0.3, random: () => 0.29, sleep: noSleep });
    expect((await p.send("9841234567", "hi")).success).toBe(false);
  });
  it("succeeds when random >= failureRate", async () => {
    const p = new MockProvider({ name: "R", failureRate: 0.3, random: () => 0.3, sleep: noSleep });
    expect((await p.send("9841234567", "hi")).success).toBe(true);
  });
  it("failureRate 0 never fails and 1 always fails", async () => {
    const never = new MockProvider({ name: "R", failureRate: 0, random: () => 0, sleep: noSleep });
    const always = new MockProvider({ name: "R", failureRate: 1, random: () => 0.999, sleep: noSleep });
    expect((await never.send("9841234567", "x")).success).toBe(true);
    expect((await always.send("9841234567", "x")).success).toBe(false);
  });
  it("getBalance reads from the injected loader", async () => {
    const p = new MockProvider({ name: "R", failureRate: 0, loadBalance: async () => 42 });
    expect(await p.getBalance()).toBe(42);
  });
});
