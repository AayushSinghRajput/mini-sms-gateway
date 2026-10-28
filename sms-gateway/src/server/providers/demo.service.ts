import { z } from "zod";
import { prisma } from "../db";
import { NotFoundError } from "../errors";

const schema = z
  .object({
    name: z.string().min(1), // a route name such as ROUTE_A, or "all"
    failureRate: z.number().min(0).max(1).optional(),
    balance: z.number().int().min(0).max(10_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => d.failureRate !== undefined || d.balance !== undefined || d.isActive !== undefined, {
    message: "provide at least one of failureRate, balance, isActive",
  });

/** Demo-only: change a mock route's failure rate / balance / active flag so failover and refunds can be shown on demand. */
export async function updateRoutes(input: unknown) {
  const { name, ...data } = schema.parse(input);
  const res = await prisma.provider.updateMany({ where: name === "all" ? {} : { name }, data });
  if (res.count === 0) throw new NotFoundError(`No route named "${name}"`);
  const rows = await prisma.provider.findMany({ orderBy: { priority: "asc" } });
  return rows.map((r) => ({ name: r.name, priority: r.priority, balance: r.balance, failureRate: r.failureRate, isActive: r.isActive }));
}
