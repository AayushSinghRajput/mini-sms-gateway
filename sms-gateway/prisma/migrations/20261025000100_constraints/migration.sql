-- Database-level safety nets: even a bug in application code cannot make a balance negative.
ALTER TABLE "wallets"   ADD CONSTRAINT "wallets_balance_nonneg"           CHECK ("balance" >= 0);
ALTER TABLE "providers" ADD CONSTRAINT "providers_balance_nonneg"         CHECK ("balance" >= 0);
ALTER TABLE "providers" ADD CONSTRAINT "providers_failure_rate_range"     CHECK ("failure_rate" >= 0 AND "failure_rate" <= 1);
