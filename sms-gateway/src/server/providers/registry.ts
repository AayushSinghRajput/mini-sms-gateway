import { prisma } from "../db";
import { config } from "../config";
import { MockProvider } from "./mock-provider";
import type { ProviderRow, SmsProvider } from "./types";

/** Build a runtime provider from its DB row. */
export function createProvider(row: ProviderRow): SmsProvider {
  return new MockProvider({
    name: row.name,
    failureRate: row.failureRate,
    latencyMs: config.MOCK_LATENCY_MS,
    loadBalance: async () => (await prisma.provider.findUniqueOrThrow({ where: { id: row.id } })).balance,
  });
}
