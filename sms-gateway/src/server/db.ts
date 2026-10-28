import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config";

// Singleton so Next.js dev hot-reload does not open a new connection pool on every reload.
// Uses the Postgres driver adapter (engineType = "client" in schema.prisma): no Rust engine binary.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; pool?: Pool };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const pool = new Pool({ connectionString: config.DATABASE_URL });
    globalForPrisma.pool = pool;
    globalForPrisma.prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    if (prop === "$transaction") {
      return (arg: any, options?: any) => {
        const opts = { maxWait: 10_000, timeout: 20_000, ...options };
        return typeof arg === "function" ? client.$transaction(arg, opts) : client.$transaction(arg, options);
      };
    }
    const value = (client as any)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

