export interface HealthInput {
  attempts: number;
  successes: number;
  balance: number;
  lowBalanceThreshold: number;
  isActive: boolean;
}
export type HealthLabel = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export interface HealthResult { successRate: number | null; healthPercent: number; label: HealthLabel }

/**
 * Route health formula (see README):
 *   successScore  = attempts > 0 ? successes / attempts : 1   (no data in 24h -> assume healthy)
 *   balanceFactor = min(1, balance / lowBalanceThreshold)
 *   health %      = round(100 * successScore * balanceFactor), 0 if the route is inactive
 */
export function computeHealth(i: HealthInput): HealthResult {
  const successScore = i.attempts > 0 ? i.successes / i.attempts : 1;
  const balanceFactor = i.lowBalanceThreshold > 0 ? Math.min(1, Math.max(0, i.balance) / i.lowBalanceThreshold) : 1;
  const healthPercent = i.isActive ? Math.round(100 * successScore * balanceFactor) : 0;
  const label: HealthLabel = healthPercent >= 80 ? "HEALTHY" : healthPercent >= 50 ? "DEGRADED" : "UNHEALTHY";
  return {
    successRate: i.attempts > 0 ? Math.round(successScore * 1000) / 10 : null,
    healthPercent,
    label,
  };
}
