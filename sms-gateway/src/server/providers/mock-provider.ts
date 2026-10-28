import type { SendResult, SmsProvider } from "./types";

export interface MockProviderOptions {
  name: string;
  failureRate: number;                    // 0..1
  latencyMs?: number;
  random?: () => number;                  // injectable for deterministic tests
  sleep?: (ms: number) => Promise<void>;  // injectable for fast tests
  loadBalance?: () => Promise<number>;    // where getBalance() reads from (the DB in production)
}

/** A fake SMS route: waits a little, then fails with probability `failureRate`. */
export class MockProvider implements SmsProvider {
  readonly name: string;
  private readonly failureRate: number;
  private readonly latencyMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly loadBalance: () => Promise<number>;

  constructor(opts: MockProviderOptions) {
    this.name = opts.name;
    this.failureRate = opts.failureRate;
    this.latencyMs = opts.latencyMs ?? 0;
    this.random = opts.random ?? Math.random;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.loadBalance = opts.loadBalance ?? (async () => 0);
  }

  getBalance(): Promise<number> {
    return this.loadBalance();
  }

  async send(_to: string, _body: string): Promise<SendResult> {
    if (this.latencyMs > 0) await this.sleep(this.latencyMs * (0.5 + this.random())); // 0.5x-1.5x jitter
    if (this.random() < this.failureRate) return { success: false, error: `${this.name}: simulated provider failure` };
    return { success: true };
  }
}
