import { prisma } from "./lib/db";

// Usage: npm run route:set -- ROUTE_A --failure 1 --balance 500 --active true
//        npm run route:set -- all --failure 0
function usage(): never {
  console.log("Usage: npm run route:set -- <ROUTE_NAME|all> [--failure 0..1] [--balance N] [--active true|false]");
  process.exit(1);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name) usage();
  const data: { failureRate?: number; balance?: number; isActive?: boolean } = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i]; const val = rest[i + 1];
    if (val === undefined) usage();
    if (flag === "--failure") { const n = Number(val); if (!(n >= 0 && n <= 1)) usage(); data.failureRate = n; }
    else if (flag === "--balance") { const n = Number(val); if (!Number.isInteger(n) || n < 0) usage(); data.balance = n; }
    else if (flag === "--active") { if (val !== "true" && val !== "false") usage(); data.isActive = val === "true"; }
    else usage();
  }
  if (Object.keys(data).length === 0) usage();

  const where = name === "all" ? {} : { name };
  const res = await prisma.provider.updateMany({ where, data });
  if (res.count === 0) { console.log(`No provider matched "${name}"`); process.exit(1); }
  const rows = await prisma.provider.findMany({ orderBy: { priority: "asc" } });
  console.table(rows.map((r) => ({ name: r.name, priority: r.priority, balance: r.balance, failureRate: r.failureRate, active: r.isActive })));
  await prisma.$disconnect();
}
main();
