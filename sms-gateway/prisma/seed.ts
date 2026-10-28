import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const providers = [
  { name: "ROUTE_A", priority: 1, balance: 10000, failureRate: 0.3 },
  { name: "ROUTE_B", priority: 2, balance: 10000, failureRate: 0.1 },
  { name: "ROUTE_C", priority: 3, balance: 5000, failureRate: 0.05 },
];

async function main() {
  for (const p of providers) {
    // Idempotent: re-running the seed does not reset balances/failure rates of existing providers.
    await prisma.provider.upsert({ where: { name: p.name }, update: {}, create: p });
  }
  console.log("Seeded providers:", providers.map((p) => p.name).join(", "));
}

main().finally(() => prisma.$disconnect());
