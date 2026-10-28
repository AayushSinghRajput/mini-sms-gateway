import { prisma } from "./lib/db";
import { verifyLedger } from "./lib/ledger";

async function main() {
  const r = await verifyLedger(prisma);
  console.log(`Checked ${r.wallets} wallet(s).`);
  if (r.ok) console.log("PASS: every wallet balance equals its ledger, and every refund is consistent.");
  else { console.log("FAIL:"); r.problems.forEach((p) => console.log(" - " + p)); }
  await prisma.$disconnect();
  process.exit(r.ok ? 0 : 1);
}
main();
