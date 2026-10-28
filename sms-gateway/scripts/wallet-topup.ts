import { prisma } from "./lib/db";

// Usage: npm run wallet:topup -- user@example.com 50
async function main() {
  const [email, amountRaw] = process.argv.slice(2);
  const amount = Number(amountRaw);
  if (!email || !Number.isInteger(amount) || amount < 1) {
    console.log("Usage: npm run wallet:topup -- <email> <positive integer amount>");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) { console.log(`No user with email ${email}`); process.exit(1); }

  const balance = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ balance: number }[]>`
      UPDATE wallets SET balance = balance + ${amount}, updated_at = now() WHERE user_id = ${user.id} RETURNING balance`;
    await tx.creditTransaction.create({ data: { userId: user.id, type: "CREDIT", amount, balanceAfter: rows[0].balance } });
    return rows[0].balance;
  });
  console.log(`Added ${amount} credits to ${email}. New balance: ${balance}`);
  await prisma.$disconnect();
}
main();
