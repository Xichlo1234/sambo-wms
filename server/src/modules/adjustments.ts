/**
 * ĐIỀU CHỈNH TỒN KHO – mọi điều chỉnh phải có lý do + người phê duyệt khác người lập.
 * Nguồn: MANUAL (lập tay), STOCKTAKE (từ kiểm kê), OPENING (import tồn đầu kỳ)
 * DRAFT → SUBMITTED → POSTED | REJECTED | CANCELLED
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx, type Tx } from '../db';
import { requirePerm, assertNotSelf } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission, notifyUsers } from '../lib/notify';
import { postMovements, toDateOnly, type MoveInput } from '../services/inventory';

const r = Router();
const ENTITY = 'stock_adjustment';

const lineSchema = z.object({
  item_id: z.coerce.number().int().positive('Chọn vật tư'),
  location_id: z.coerce.number().int().positive('Chọn vị trí'),
  bucket: z.enum(['USABLE', 'QUARANTINE', 'DAMAGED']).default('USABLE'),
  qty_delta: z.coerce.number().refine((v) => v !== 0, 'SL điều chỉnh phải khác 0'),
  unit_price: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().min(0)]).optional(),
  reason: zOptStr,
});

const schema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  doc_date: z.coerce.date(),
  reason: z.string().trim().min(5, 'Bắt buộc nhập lý do điều chỉnh (tối thiểu 5 ký tự)'),
  note: zOptStr,
  lines: z.array(lineSchema).min(1, 'Phải có ít nhất 1 dòng'),
});

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  stocktake: { select: { id: true, code: true } },
  creator: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } }, location: { select: { id: true, code: true } } } },
} satisfies Prisma.StockAdjustmentInclude;

/** Dùng chung cho kiểm kê & import tồn đầu kỳ */
export async function createAdjustment(
  tx: Tx, userId: number,
  d: { warehouse_id: number; doc_date: Date; reason: string; note?: string | null; source: 'MANUAL' | 'STOCKTAKE' | 'OPENING'; stocktake_id?: number; status?: 'DRAFT' | 'SUBMITTED'; client_request_id?: string },
  lines: z.infer<typeof lineSchema>[],
) {
  const code = await nextDocNo(tx, DOC_PREFIX.ADJUSTMENT, d.doc_date);
  const status = d.status ?? 'DRAFT';
  const c = await tx.stockAdjustment.create({
    data: {
      code, warehouse_id: d.warehouse_id, doc_date: toDateOnly(d.doc_date), reason: d.reason, note: d.note ?? null, source: d.source,
      stocktake_id: d.stocktake_id ?? null, status, client_request_id: d.client_request_id,
      submitted_at: status === 'SUBMITTED' ? new Date() : null,
      created_by: userId, updated_by: userId,
      lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1, unit_price: l.unit_price ?? null })) },
    },
  });
  await history(tx, ENTITY, c.id, 'CREATE', userId, null, status);
  return c;
}

async function validate(d: z.infer<typeof schema>) {
  const wh = await prisma.warehouse.findUnique({ where: { id: d.warehouse_id } });
  if (!wh || wh.type !== 'GENERAL') throw badRequest('Kho không hợp lệ cho điều chỉnh kho mỏ');
  const locs = await prisma.warehouseLocation.findMany({ where: { id: { in: d.lines.map((l) => l.location_id) } } });
  if (d.lines.some((l) => locs.find((x) => x.id === l.location_id)?.warehouse_id !== d.warehouse_id)) throw badRequest('Vị trí không thuộc kho đã chọn');
}

r.get('/', requirePerm('adjustments.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.StockAdjustmentWhereInput = {};
  if (req.query.q) where.OR = [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { reason: { contains: String(req.query.q), mode: 'insensitive' } }];
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  if (req.query.source) where.source = String(req.query.source) as 'MANUAL';
  const [rows, total] = await Promise.all([
    prisma.stockAdjustment.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { warehouse: { select: { code: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.stockAdjustment.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('adjustments.view'), async (req, res) => {
  const doc = await prisma.stockAdjustment.findUnique({ where: { id: Number(req.params.id) }, include });
  if (!doc) throw notFound();
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, { ...doc, history: hist });
});

r.post('/', requirePerm('adjustments.create'), async (req, res) => {
  const d = schema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.stockAdjustment.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validate(d);
  const doc = await withTx(async (tx) => {
    const c = await createAdjustment(tx, req.user!.id, { ...d, source: 'MANUAL' }, d.lines);
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

r.post('/:id/submit', requirePerm('adjustments.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockAdjustment', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, doc.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, undefined, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['adjustments.approve'], req.user!.id, { type: 'APPROVAL', title: `Phiếu điều chỉnh ${doc.code} chờ duyệt`, link: `/adjustments/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

/** Phê duyệt & ghi sổ phiếu điều chỉnh – dùng chung cho màn hình Kiểm kê */
export async function approveAdjustment(req: Request, id: number, comment?: string | null) {
  const doc = await prisma.stockAdjustment.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by]);
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'stockAdjustment', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now, posted_at: now });
    const type = doc.source === 'OPENING' ? 'OPENING' : doc.source === 'STOCKTAKE' ? 'STOCKTAKE' : 'ADJUSTMENT';
    const moves: MoveInput[] = doc.lines.map((l) => ({
      warehouse_id: doc.warehouse_id, location_id: l.location_id, item_id: l.item_id, bucket: l.bucket,
      direction: l.qty_delta.gt(0) ? 'IN' : 'OUT', qty: l.qty_delta.abs(), movement_type: type,
      doc_type: 'ADJUSTMENT', doc_id: doc.id, doc_code: doc.code, doc_line_id: l.id, doc_date: doc.doc_date,
      unit_cost: l.unit_price, note: l.reason || doc.reason,
    }));
    await postMovements(tx, req.user!.id, moves);
    if (doc.stocktake_id) {
      await transition(tx, 'stocktake', doc.stocktake_id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now });
      await history(tx, 'stocktake', doc.stocktake_id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', `Ghi sổ điều chỉnh ${doc.code}`);
    }
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', ENTITY, doc, undefined, { status: 'POSTED' }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'INFO', title: `Phiếu điều chỉnh ${doc.code} đã ghi sổ`, link: `/adjustments/${id}` });
  });
}

r.post('/:id/approve', requirePerm('adjustments.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  await approveAdjustment(req, id, comment);
  ok(res, { id, status: 'POSTED' });
});

r.post('/:id/reject', requirePerm('adjustments.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'stockAdjustment', id, ['SUBMITTED'], { status: 'REJECTED', reject_reason: reason });
    if (doc.stocktake_id) {
      // Trả đợt kiểm kê về trạng thái kiểm đếm để giải trình lại
      await tx.stocktake.update({ where: { id: doc.stocktake_id }, data: { status: 'COUNTING', reject_reason: reason } });
      await tx.stockAdjustment.update({ where: { id }, data: { stocktake_id: null, status: 'CANCELLED', cancel_reason: 'Từ chối kết quả kiểm kê: ' + reason, cancelled_by: req.user!.id, cancelled_at: new Date() } });
      await history(tx, 'stocktake', doc.stocktake_id, 'REJECT', req.user!.id, 'SUBMITTED', 'COUNTING', reason);
    }
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, 'SUBMITTED', 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, doc, undefined, { reason }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'WARNING', title: `Phiếu điều chỉnh ${doc.code} bị từ chối`, message: reason, link: `/adjustments/${id}` });
  });
  ok(res, { id, status: 'REJECTED' });
});

r.post('/:id/cancel', requirePerm('adjustments.create'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockAdjustment.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (doc.source === 'STOCKTAKE') throw ruleViolation('Phiếu điều chỉnh từ kiểm kê được xử lý trong màn hình Kiểm kê');
  await withTx(async (tx) => {
    await transition(tx, 'stockAdjustment', id, ['DRAFT', 'SUBMITTED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
