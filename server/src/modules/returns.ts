/**
 * HÀNG TRẢ LẠI (5.1.7) – bộ phận sử dụng trả vật tư về kho.
 * DRAFT → SUBMITTED → INSPECTED (kho kiểm tra & phân loại) → POSTED (phê duyệt & ghi sổ)
 * Chỉ SL "dùng được" mới tăng tồn khả dụng; hư hỏng → tồn hư hỏng; chưa kết luận → tồn chờ kiểm tra.
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, assertNotSelf, can } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, forbidden, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission, notifyUsers } from '../lib/notify';
import { postMovements, toDateOnly, type MoveInput } from '../services/inventory';

const r = Router();
const ENTITY = 'stock_return';
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const schema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  department_id: z.coerce.number().int().positive('Chọn bộ phận trả'),
  related_issue_id: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  doc_date: z.coerce.date(),
  returned_by_name: z.string().trim().min(2, 'Nhập người trả'),
  reason: z.string().trim().min(3, 'Nhập lý do trả'),
  note: zOptStr,
  lines: z.array(z.object({
    item_id: z.coerce.number().int().positive('Chọn vật tư'),
    location_id: z.coerce.number().int().positive('Chọn vị trí nhận về'),
    qty_returned: z.coerce.number().positive('SL trả phải > 0'),
    reason: zOptStr,
  })).min(1),
});

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  related_issue: { select: { id: true, code: true } },
  creator: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } }, location: { select: { id: true, code: true } } } },
} satisfies Prisma.StockReturnInclude;

function scope(req: Request): Prisma.StockReturnWhereInput {
  if (can(req, 'returns.inspect') || can(req, 'returns.approve') || can(req, 'issues.view_all')) return {};
  return { OR: [{ created_by: req.user!.id }, ...(req.user!.department_id ? [{ department_id: req.user!.department_id }] : [])] };
}

async function validate(req: Request, d: z.infer<typeof schema>) {
  if (!can(req, 'issues.view_all') && !can(req, 'returns.inspect') && d.department_id !== req.user!.department_id) throw forbidden('Chỉ được lập phiếu trả cho bộ phận của mình');
  const locs = await prisma.warehouseLocation.findMany({ where: { id: { in: d.lines.map((l) => l.location_id) } } });
  if (d.lines.some((l) => locs.find((x) => x.id === l.location_id)?.warehouse_id !== d.warehouse_id)) throw badRequest('Vị trí không thuộc kho đã chọn');
  const wh = await prisma.warehouse.findUnique({ where: { id: d.warehouse_id } });
  if (wh?.type !== 'GENERAL') throw badRequest('Hàng trả lại kho mỏ chỉ áp dụng kho vật tư');
}

r.get('/', requirePerm('returns.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.StockReturnWhereInput[] = [scope(req)];
  if (req.query.q) and.push({ code: { contains: String(req.query.q), mode: 'insensitive' } });
  if (req.query.status) and.push({ status: String(req.query.status) as 'DRAFT' });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.stockReturn.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { department: { select: { name: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.stockReturn.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('returns.view'), async (req, res) => {
  const doc = await prisma.stockReturn.findFirst({ where: { id: Number(req.params.id), ...scope(req) }, include });
  if (!doc) throw notFound();
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, { ...doc, history: hist });
});

r.post('/', requirePerm('returns.create'), async (req, res) => {
  const d = schema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.stockReturn.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validate(req, d);
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.RETURN, d.doc_date);
    const { lines, ...head } = d;
    const c = await tx.stockReturn.create({ data: { ...head, code, doc_date: toDateOnly(d.doc_date), created_by: req.user!.id, updated_by: req.user!.id, lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } } });
    await history(tx, ENTITY, c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

r.post('/:id/submit', requirePerm('returns.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stockReturn.findFirst({ where: { id, ...scope(req) } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockReturn', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, doc.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, undefined, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['returns.inspect'], req.user!.id, { type: 'TASK', title: `Phiếu trả ${doc.code} chờ kiểm tra chất lượng`, link: `/returns/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

r.post('/:id/inspect', requirePerm('returns.inspect'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    lines: z.array(z.object({
      id: z.coerce.number().int(),
      qty_usable: z.coerce.number().min(0), qty_damaged: z.coerce.number().min(0), qty_pending: z.coerce.number().min(0),
      inspection_note: zOptStr,
    })).min(1),
  }).parse(req.body);
  const doc = await prisma.stockReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockReturn', id, ['SUBMITTED'], { status: 'INSPECTED', inspected_by: req.user!.id, inspected_at: new Date() });
    for (const l of doc.lines) {
      const g = d.lines.find((x) => x.id === l.id);
      if (!g) throw badRequest(`Chưa nhập kết quả kiểm tra dòng ${l.line_no}`);
      if (!D(g.qty_usable).plus(g.qty_damaged).plus(g.qty_pending).equals(l.qty_returned)) throw badRequest(`Dòng ${l.line_no}: dùng được + hư hỏng + chờ xử lý phải bằng SL trả (${l.qty_returned})`);
      if ((g.qty_damaged > 0 || g.qty_pending > 0) && !g.inspection_note) throw badRequest(`Dòng ${l.line_no}: bắt buộc ghi nhận xét khi có hàng hư hỏng/chờ xử lý`);
      await tx.stockReturnItem.update({ where: { id: l.id }, data: { qty_usable: g.qty_usable, qty_damaged: g.qty_damaged, qty_pending: g.qty_pending, inspection_note: g.inspection_note } });
    }
    await history(tx, ENTITY, id, 'INSPECT', req.user!.id, 'SUBMITTED', 'INSPECTED');
    await audit(req, 'INSPECT', ENTITY, doc, undefined, d, tx);
    await notifyPermission(tx, ['returns.approve'], req.user!.id, { type: 'APPROVAL', title: `Phiếu trả ${doc.code} chờ duyệt ghi sổ`, link: `/returns/${id}` });
  });
  ok(res, { id, status: 'INSPECTED' });
});

r.post('/:id/approve', requirePerm('returns.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const doc = await prisma.stockReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by]);
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'stockReturn', id, ['INSPECTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now, posted_at: now });
    const moves: MoveInput[] = [];
    for (const l of doc.lines) {
      const base = { warehouse_id: doc.warehouse_id, location_id: l.location_id, item_id: l.item_id, direction: 'IN' as const, movement_type: 'RETURN' as const, doc_type: 'RETURN', doc_id: doc.id, doc_code: doc.code, doc_line_id: l.id, doc_date: doc.doc_date, department_id: doc.department_id, note: doc.reason };
      if (l.qty_usable?.gt(0)) moves.push({ ...base, bucket: 'USABLE', qty: l.qty_usable });
      if (l.qty_damaged?.gt(0)) moves.push({ ...base, bucket: 'DAMAGED', qty: l.qty_damaged });
      if (l.qty_pending?.gt(0)) moves.push({ ...base, bucket: 'QUARANTINE', qty: l.qty_pending });
    }
    if (!moves.length) throw ruleViolation('Phiếu chưa có kết quả kiểm tra');
    await postMovements(tx, req.user!.id, moves);
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'INSPECTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', ENTITY, doc, undefined, { status: 'POSTED' }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'INFO', title: `Phiếu trả ${doc.code} đã ghi sổ`, link: `/returns/${id}` });
  });
  ok(res, { id, status: 'POSTED' });
});

r.post('/:id/reject', requirePerm('returns.inspect', 'returns.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockReturn.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'stockReturn', id, ['SUBMITTED', 'INSPECTED'], { status: 'REJECTED', reject_reason: reason });
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, doc.status, 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'REJECTED' });
});

r.post('/:id/cancel', requirePerm('returns.create'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stockReturn.findFirst({ where: { id, ...scope(req) } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stockReturn', id, ['DRAFT', 'SUBMITTED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
