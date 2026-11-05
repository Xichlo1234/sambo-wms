import type { Request, Response } from 'express';
import { z } from 'zod';

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export function pageArgs(q: Request['query']) {
  const { page, pageSize } = paginationSchema.parse(q);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const idParam = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('ID không hợp lệ'), { status: 400 });
  return id;
};

/** Zod helpers */
export const zDate = z.coerce.date({ errorMap: () => ({ message: 'Ngày không hợp lệ' }) });
export const zQty = z.coerce.number({ invalid_type_error: 'Số lượng phải là số' }).finite();
export const zOptStr = z.string().trim().max(2000).optional().nullable().transform((v) => (v ? v : null));
export const zOptId = z.coerce.number().int().positive().optional().nullable().or(z.literal('').transform(() => null));
