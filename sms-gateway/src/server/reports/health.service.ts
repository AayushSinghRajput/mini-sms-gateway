import { prisma } from "../db";
import { config } from "../config";
import { computeHealth } from "./compute-health";

interface StatRow {
  provider_id: string;
  attempts: number;
  successes: number;
}

interface ProviderRow {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  balance: number;
  failureRate: number;
}

export async function getRoutesHealth() {
  const providers = await prisma.provider.findMany({ orderBy: { priority: "asc" } });
  const stats = await prisma.$queryRaw<StatRow[]>`
    SELECT provider_id,
           COUNT(*)::int AS attempts,
           (COUNT(*) FILTER (WHERE success))::int AS successes
    FROM send_attempts
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY provider_id`;
  const byProvider = new Map<string, StatRow>(stats.map((s) => [s.provider_id, s]));

  return providers.map((p: ProviderRow) => {
    const s = byProvider.get(p.id);
    const attempts = s?.attempts ?? 0;
    const successes = s?.successes ?? 0;
    const h = computeHealth({ attempts, successes, balance: p.balance, lowBalanceThreshold: config.LOW_BALANCE_THRESHOLD, isActive: p.isActive });
    return {
      name: p.name,
      priority: p.priority,
      isActive: p.isActive,
      balance: p.balance,
      failureRate: p.failureRate,
      attempts24h: attempts,
      successRate24h: h.successRate,
      healthPercent: h.healthPercent,
      label: h.label,
    };
  });
}
