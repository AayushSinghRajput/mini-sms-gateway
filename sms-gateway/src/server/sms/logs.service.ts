import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { ValidationError } from "../errors";
import { normalizeNepaliMobile } from "./phone";

const dateField = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO date or datetime");

const querySchema = z.object({
  status: z.string().transform((s) => s.toUpperCase()).pipe(z.enum(["PENDING", "SENT", "FAILED"])).optional(),
  from: dateField.optional(),
  to: dateField.optional(),
  number: z.string().trim().min(1).max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /sms/logs: paginated, filterable by status, date range and number. Scoped to the caller. */
export async function getLogs(userId: string, params: Record<string, string>) {
  const q = querySchema.parse(params);

  const createdAt: Prisma.DateTimeFilter = {};
  if (q.from) createdAt.gte = new Date(q.from);
  if (q.to) {
    if (DATE_ONLY.test(q.to)) {
      const end = new Date(q.to); // midnight UTC of that day
      end.setUTCDate(end.getUTCDate() + 1);
      createdAt.lt = end; // a date-only `to` includes the whole day
      if (createdAt.gte && createdAt.gte >= end) throw new ValidationError("`from` must not be after `to`");
    } else {
      createdAt.lte = new Date(q.to);
      if (createdAt.gte && createdAt.gte > createdAt.lte) throw new ValidationError("`from` must not be after `to`");
    }
  }

  const where: Prisma.MessageWhereInput = { userId };
  if (q.status) where.status = q.status;
  if (createdAt.gte || createdAt.lt || createdAt.lte) where.createdAt = createdAt;
  if (q.number) {
    const normalised = normalizeNepaliMobile(q.number);
    where.to = normalised ? normalised : { contains: q.number.replace(/[\s+-]/g, "") }; // exact if it is a full number, else partial
  }

  const [total, rows] = await Promise.all([
    prisma.message.count({ where }),
    prisma.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      include: { provider: true },
    }),
  ]);

  return {
    data: rows.map((m) => ({
      id: m.id,
      to: m.to,
      status: m.status,
      encoding: m.encoding,
      parts: m.parts,
      cost: m.cost,
      provider: m.provider?.name ?? null,
      refunded: m.refunded,
      createdAt: m.createdAt,
      sentAt: m.sentAt,
      failureReason: m.failureReason,
    })),
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
}
