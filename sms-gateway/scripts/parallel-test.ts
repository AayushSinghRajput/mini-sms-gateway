import { prisma } from "./lib/db";
import { verifyLedger } from "./lib/ledger";

/**
 * Proves "never lose or double-spend a credit".
 *
 *   npm run test:parallel                   # 20 parallel sends vs a wallet that affords exactly 10
 *   npm run test:parallel -- --with-failures # 50 sends with the real failure rates; checks the ledger invariant
 *
 * Needs the API running (BASE_URL, default http://localhost:3000).
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const withFailures = process.argv.includes("--with-failures");

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Set a wallet to an exact balance, recording the adjustment in the ledger so invariants still hold. */
async function setBalanceExact(userId: string, target: number) {
  await prisma.$transaction(async (tx) => {
    const cur = (await tx.wallet.findUniqueOrThrow({ where: { userId } })).balance;
    const diff = target - cur;
    if (diff === 0) return;
    await tx.$executeRaw`UPDATE wallets SET balance = ${target}, updated_at = now() WHERE user_id = ${userId}`;
    await tx.creditTransaction.create({
      data: { userId, type: diff > 0 ? "CREDIT" : "DEBIT", amount: Math.abs(diff), balanceAfter: target },
    });
  });
}

const randomNumber = () => "98" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

async function main() {
  const original = await prisma.provider.findMany();
  try {
    if (!withFailures) {
      await prisma.provider.updateMany({ data: { failureRate: 0 } }); // refunds would legitimately free up credits mid-test
      console.log("All routes set to failureRate 0 for this test (restored afterwards).");
    }

    const email = `parallel-${Date.now()}@example.com`;
    const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "password123" }) });
    if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.body)}`);
    const { token, user } = reg.body;

    const startBalance = withFailures ? 25 : 10;
    const requests = withFailures ? 50 : 20;
    await setBalanceExact(user.id, startBalance);
    console.log(`Wallet = ${startBalance} credits. Firing ${requests} parallel sends (1 recipient, 1 part = 1 credit each)...`);

    const results = await Promise.all(
      Array.from({ length: requests }, () =>
        api("/api/sms/send", { method: "POST", token, body: JSON.stringify({ to: [randomNumber()], message: "Parallel test" }) }),
      ),
    );

    const count = (s: number) => results.filter((r) => r.status === s).length;
    const accepted = count(200), rejected402 = count(402), limited = count(429);
    const other = requests - accepted - rejected402 - limited;
    const wallet = await api("/api/wallet", { token });
    const ledger = await verifyLedger(prisma);
    console.log({ accepted, rejected402, rateLimited429: limited, other, finalBalance: wallet.body.balance, ledgerOk: ledger.ok });
    if (!ledger.ok) ledger.problems.forEach((p) => console.log(" - " + p));

    let ok = ledger.ok && other === 0 && limited === 0 && wallet.body.balance >= 0;
    if (!withFailures) ok = ok && accepted === 10 && rejected402 === 10 && wallet.body.balance === 0;
    console.log(ok ? "\nPASS" : "\nFAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    for (const p of original) {
      await prisma.provider.update({ where: { id: p.id }, data: { failureRate: p.failureRate, balance: p.balance } });
    }
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
