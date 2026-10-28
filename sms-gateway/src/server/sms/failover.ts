import type { ProviderRow, SendResult, SmsProvider } from "../providers/types";

/** Everything the failover algorithm needs from the outside world. Injected so it can be unit tested. */
export interface FailoverRepo {
  getMessage(id: string): Promise<{ id: string; status: string; parts: number; to: string; body: string } | null>;
  /** Active providers, already ordered by priority (lowest number first). */
  listActiveProviders(): Promise<ProviderRow[]>;
  /** Atomically take `parts` from the provider balance. false = not enough balance. */
  reserveProviderBalance(providerId: string, parts: number): Promise<boolean>;
  releaseProviderBalance(providerId: string, parts: number): Promise<void>;
  recordAttempt(messageId: string, providerId: string, success: boolean, error?: string): Promise<void>;
  /** PENDING -> SENT, guarded. false = someone else already finalised the message. */
  markSent(messageId: string, providerId: string): Promise<boolean>;
  /** PENDING -> FAILED + credits back, exactly once. */
  refund(messageId: string, reason: string): Promise<void>;
}

export type ProcessOutcome =
  | { status: "SENT"; provider: string }
  | { status: "FAILED" }
  | { status: "SKIPPED" };

/**
 * Try providers in priority order until one accepts the message; refund if none does.
 *
 *  - A provider without enough balance is skipped silently (no attempt recorded).
 *  - Provider balance is reserved BEFORE the send and given back if the send fails.
 *  - Safe to call twice for the same message: non-PENDING messages are ignored,
 *    and the final transitions are guarded in the repo.
 */
export async function runFailover(
  repo: FailoverRepo,
  makeProvider: (row: ProviderRow) => SmsProvider,
  messageId: string,
): Promise<ProcessOutcome> {
  const msg = await repo.getMessage(messageId);
  if (!msg || msg.status !== "PENDING") return { status: "SKIPPED" };

  const providers = await repo.listActiveProviders();
  for (const row of providers) {
    if (!(await repo.reserveProviderBalance(row.id, msg.parts))) continue; // route out of balance: skip

    let result: SendResult;
    try {
      result = await makeProvider(row).send(msg.to, msg.body);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) };
    }
    await repo.recordAttempt(msg.id, row.id, result.success, result.error);

    if (result.success) {
      const finalised = await repo.markSent(msg.id, row.id);
      if (!finalised) {
        await repo.releaseProviderBalance(row.id, msg.parts); // lost the race: do not keep the reservation
        return { status: "SKIPPED" };
      }
      return { status: "SENT", provider: row.name };
    }
    await repo.releaseProviderBalance(row.id, msg.parts); // failed: give the reserved balance back, try next route
  }

  await repo.refund(msg.id, "ALL_ROUTES_FAILED");
  return { status: "FAILED" };
}
