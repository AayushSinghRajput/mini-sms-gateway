export interface SendResult { success: boolean; error?: string }

export interface SmsProvider {
  readonly name: string;
  getBalance(): Promise<number>;
  send(to: string, body: string): Promise<SendResult>;
}

/** A provider row as stored in the DB. */
export interface ProviderRow {
  id: string;
  name: string;
  priority: number;
  balance: number;
  failureRate: number;
  isActive: boolean;
}
