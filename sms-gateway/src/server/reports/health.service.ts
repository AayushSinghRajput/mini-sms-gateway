import { prisma } from "../db";
import { config } from "../config";
import { computeHealth } from "./compute-health";

export async function getRoutesHealth() {
  const providers = await prisma.provider.findMany({ orderBy: { priority: "asc" } });
  const stats = await prisma.$queryRaw<{ provider_id: string; attempts: number; successes: number }[]>`
    SELECT provider_id,
           COUNT(*)::int AS attempts,
           (COUNT(*) FILTER (WHERE success))::int AS successes
    FROM send_attempts
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY provider_id`;
  const byProvider = new Map(stats.map((s) => [s.provider_id, s]));

  return providers.map((p) => {
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
