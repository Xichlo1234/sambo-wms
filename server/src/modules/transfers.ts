/**
 * ĐIỀU CHUYỂN (5.1.7) – giữa các vị trí trong kho hoặc giữa các kho.
 * DRAFT → SUBMITTED → POSTED (phê duyệt = xác nhận bàn giao & ghi sổ 2 chiều trong cùng transaction)
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, assertNotSelf } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission, notifyUsers } from '../lib/notify';
import { postMovements, toDateOnly, type MoveInput } from '../services/inventory';

const r = Router();
const ENTITY = 'stock_transfer';

const schema = z.object({
  client_request_id: z.string().max(64).optional(),
  from_warehouse_id: z.coerce.number().int().positive('Chọn kho đi'),
  to_warehouse_id: z.coerce.number().int().positive('Chọn kho đến'),
  doc_date: z.coerce.date(),
  sender_name: z.string().trim().min(2, 'Nhập người giao'),
  receiver_name: z.string().trim().min(2, 'Nhập người nhận'),
  reason: z.string().trim().min(3, 'Nhập lý do điều chuyển'),
  note: zOptStr,
  lines: z.array(z.object({
    item_id: z.coerce.number().int().positive('Chọn vật tư'),
    from_location_id: z.coerce.number().int().positive('Chọn vị trí đi'),
    to_location_id: z.coerce.number().int().positive('Chọn vị trí đến'),
    qty: z.coerce.number().positive('SL phải > 0'),
    note: zOptStr,
  })).min(1, 'Phải có ít nhất 1 dòng'),
});

const include = {
  from_warehouse: { select: { id: true, code: true, name: true } },
  to_warehouse: { select: { id: true, code: true, name: true } },
  creator: { select: { id: true, full_name: true } },
  lines: {
    orderBy: { line_no: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
      from_location: { select: { id: true, code: true } },
      to_location: { select: { id: true, code: true } },
    },
  },
} satisfies Prisma.StockTransferInclude;

async function validate(d: z.infer<typeof schema>) {
  const locIds = d.lines.flatMap((l) => [l.from_location_id, l.to_location_id]);
  const locs = await prisma.warehouseLocation.findMany({ where: { id: { in: locIds } } });
  const whs = await prisma.warehouse.findMany({ where: { id: { in: [d.from_warehouse_id, d.to_warehouse_id] } } });
  if (whs.some((w) => w.type !== 'GENERAL')) throw badRequest('Điều chuyển kho mỏ chỉ áp dụng cho kho vật tư (không áp dụng kho hóa chất)');
  for (const l of d.lines) {
    const f = locs.find((x) => x.id === l.from_location_id);
    const t = locs.find((x) => x.id === l.to_location_id);
    if (!f || f.warehouse_id !== d.from_warehouse_id) throw badRequest('Vị trí đi không thuộc kho đi');
    if (!t || t.warehouse_id !== d.to_warehouse_id) throw badRequest('Vị trí đến không thuộc kho đến');
    if (t.status !== 'ACTIVE') throw badRequest(`Vị trí ${t.code} đã khóa`);
    if (f.id === t.id) throw badRequest('Vị trí đi và vị trí đến phải khác nhau');
  }
}

r.get('/', requirePerm('transfers.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.StockTransferWhereInput = {};
  if (req.query.q) where.code = { contains: String(req.query.q), mode: 'insensitive' };
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  const [rows, total] = await Promise.all([
    prisma.stockTransfer.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { from_warehouse: { select: { code: true } }, to_warehouse: { select: { code: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.stockTransfer.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('transfers.view'), async (req, res) => {
  const doc = await prisma.stockTransfer.findUnique({ where: { id: Number(req.params.id) }, include });
  if (!doc) throw notFound();
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, { ...doc, history: hist });
});

r.post('/', requirePerm('transfers.create'), async (req, res) => {
  const d = schema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.stockTransfer.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validate(d);
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.TRANSFER, d.doc_date);
    const { lines, ...head } = d;
    const c = await tx.stockTransfer.create({
      data: { ...head, code, doc_date: toDateOnly(d.doc_date), created_by: req.user!.id, updated_by: req.user!.id, lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } },
    });
    await history(tx, ENTITY, c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

r.put('/:id', requirePerm('transfers.create'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa');
  const d = schema.parse(req.body);
  await validate(d);
  await withTx(async (tx) => {
    await transition(tx, 'stockTransfer', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.stockTransferItem.deleteMany({ where: { transfer_id: id } });
    const { lines, client_request_id: _c, ...head } = d;
    await tx.stockTransfer.update({ where: { id }, data: { ...head, doc_date: toDateOnly(d.doc_date), status: 'DRAFT', lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } } });
    await audit(req, 'UPDATE', ENTITY, before, before, d, tx);
  });
  ok(res, { id });
});

r.post('/:id/submit', requirePerm('transfers.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockTransfer', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, doc.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, { status: doc.status }, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['transfers.approve'], req.user!.id, { type: 'APPROVAL', title: `Phiếu điều chuyển ${doc.code} chờ duyệt`, link: `/transfers/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

r.post('/:id/approve', requirePerm('transfers.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment, handover_at } = z.object({ comment: zOptStr, handover_at: z.coerce.date().optional() }).parse(req.body ?? {});
  const doc = await prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by]);
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'stockTransfer', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now, posted_at: now, handover_at: handover_at ?? now });
    const moves: MoveInput[] = [];
    for (const l of doc.lines) {
      const base = { item_id: l.item_id, bucket: 'USABLE' as const, qty: l.qty, doc_type: 'TRANSFER', doc_id: doc.id, doc_code: doc.code, doc_line_id: l.id, doc_date: doc.doc_date, note: doc.reason };
      moves.push({ ...base, warehouse_id: doc.from_warehouse_id, location_id: l.from_location_id, direction: 'OUT', movement_type: 'TRANSFER_OUT' });
      moves.push({ ...base, warehouse_id: doc.to_warehouse_id, location_id: l.to_location_id, direction: 'IN', movement_type: 'TRANSFER_IN' });
    }
    await postMovements(tx, req.user!.id, moves);
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', ENTITY, doc, { status: 'SUBMITTED' }, { status: 'POSTED' }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'INFO', title: `Điều chuyển ${doc.code} đã ghi sổ`, link: `/transfers/${id}` });
  });
  ok(res, { id, status: 'POSTED' });
});

r.post('/:id/reject', requirePerm('transfers.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'stockTransfer', id, ['SUBMITTED'], { status: 'REJECTED', reject_reason: reason });
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, 'SUBMITTED', 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'REJECTED' });
});

r.post('/:id/cancel', requirePerm('transfers.create', 'transfers.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockTransfer.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockTransfer', id, ['DRAFT', 'SUBMITTED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
