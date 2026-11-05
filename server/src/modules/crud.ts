/**
 * Bộ khung CRUD cho dữ liệu danh mục (master data).
 * - Không xóa cứng: dùng khóa/mở khóa (status ACTIVE/INACTIVE) để giữ toàn vẹn lịch sử.
 * - Mọi thay đổi ghi audit log (trước/sau).
 */
import { Router, type Request } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { prisma } from '../db';
import { requirePerm } from '../lib/auth';
import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { ok, pageArgs, pageMeta } from '../lib/http';

type AnyDelegate = {
  findMany: (a: unknown) => Promise<unknown[]>;
  findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
  count: (a: unknown) => Promise<number>;
  create: (a: unknown) => Promise<Record<string, unknown>>;
  update: (a: unknown) => Promise<Record<string, unknown>>;
};

export interface CrudOptions {
  model: string;
  entityType: string;
  viewPerm: string | string[];
  managePerm: string;
  createSchema: ZodTypeAny;
  updateSchema?: ZodTypeAny;
  searchFields: string[];
  include?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  /** Bổ sung trường dẫn xuất trước khi lưu (vd: search_text) */
  beforeSave?: (data: Record<string, unknown>, req: Request, existing?: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Lọc bổ sung từ query string */
  extraWhere?: (q: Request['query']) => Record<string, unknown>;
  /** Ẩn trường nhạy cảm theo quyền */
  present?: (row: Record<string, unknown>, req: Request) => Record<string, unknown>;
  /** Trường hiển thị cho dropdown (?all=1) */
  lookupSelect?: Record<string, boolean>;
}

export function crudRouter(o: CrudOptions) {
  const r = Router();
  const delegate = () => (prisma as unknown as Record<string, AnyDelegate>)[o.model];
  const view = Array.isArray(o.viewPerm) ? o.viewPerm : [o.viewPerm];
  const present = (row: Record<string, unknown>, req: Request) => (o.present ? o.present(row, req) : row);

  r.get('/', requirePerm(...view, o.managePerm), async (req, res) => {
    const q = String(req.query.q || '').trim();
    const where: Record<string, unknown> = { ...(o.extraWhere ? o.extraWhere(req.query) : {}) };
    if (req.query.status) where.status = String(req.query.status);
    if (q) where.OR = o.searchFields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' } }));
    if (req.query.all === '1') {
      // Danh sách rút gọn cho ô chọn – chỉ bản ghi đang hoạt động
      const rows = await delegate().findMany({
        where: { ...where, status: 'ACTIVE' },
        select: o.lookupSelect ?? { id: true, code: true, name: true },
        orderBy: o.orderBy ?? { code: 'asc' },
        take: 2000,
      });
      return ok(res, rows);
    }
    const { page, pageSize, skip, take } = pageArgs(req.query);
    const [rows, total] = await Promise.all([
      delegate().findMany({ where, include: o.include, orderBy: o.orderBy ?? { code: 'asc' }, skip, take }),
      delegate().count({ where }),
    ]);
    ok(res, (rows as Record<string, unknown>[]).map((x) => present(x, req)), pageMeta(page, pageSize, total));
  });

  r.get('/:id', requirePerm(...view, o.managePerm), async (req, res) => {
    const row = await delegate().findUnique({ where: { id: Number(req.params.id) }, include: o.include });
    if (!row) throw notFound();
    ok(res, present(row, req));
  });

  r.post('/', requirePerm(o.managePerm), async (req, res) => {
    let data = o.createSchema.parse(req.body) as Record<string, unknown>;
    if (o.beforeSave) data = await o.beforeSave(data, req);
    const row = await delegate().create({ data: { ...data, created_by: req.user!.id, updated_by: req.user!.id } });
    await audit(req, 'CREATE', o.entityType, { id: row.id as number, code: row.code as string }, undefined, row);
    ok(res, present(row, req));
  });

  r.put('/:id', requirePerm(o.managePerm), async (req, res) => {
    const id = Number(req.params.id);
    const before = await delegate().findUnique({ where: { id } });
    if (!before) throw notFound();
    let data = (o.updateSchema ?? o.createSchema).parse(req.body) as Record<string, unknown>;
    if (o.beforeSave) data = await o.beforeSave(data, req, before);
    const row = await delegate().update({ where: { id }, data: { ...data, updated_by: req.user!.id } });
    await audit(req, 'UPDATE', o.entityType, { id, code: row.code as string }, before, row);
    ok(res, present(row, req));
  });

  r.patch('/:id/status', requirePerm(o.managePerm), async (req, res) => {
    const id = Number(req.params.id);
    const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
    const before = await delegate().findUnique({ where: { id } });
    if (!before) throw notFound();
    const row = await delegate().update({ where: { id }, data: { status, updated_by: req.user!.id } });
    await audit(req, status === 'ACTIVE' ? 'UNLOCK' : 'LOCK', o.entityType, { id, code: row.code as string }, { status: before.status }, { status });
    ok(res, present(row, req));
  });

  return r;
}
