/**
 * MUA HÀNG (VII): Đề nghị mua → Yêu cầu báo giá → Đơn đặt hàng → (Phiếu nhập kho mỏ / kho hóa chất)
 * - Không tự động đặt hàng: hệ thống chỉ GỢI Ý đề nghị mua khi tồn dưới mức tối thiểu.
 * - Người lập không tự duyệt đề nghị / đơn đặt hàng.
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
import { getSettings } from '../lib/settings';
import { toDateOnly } from '../services/inventory';
import { queryNxt } from '../services/stockQueries';
import { chemAvailability } from '../services/chemicals';

export const prRouter = Router();
export const quotesRouter = Router();
export const poRouter = Router();
export const supplierExtraRouter = Router();
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const zOptDate = z.union([z.null(), z.literal('').transform(() => null), z.coerce.date()]).optional();
const userNames = async (ids: (number | null | undefined)[]) => prisma.user.findMany({ where: { id: { in: ids.filter(Boolean) as number[] } }, select: { id: true, full_name: true } });

const hidePrices = <T extends Record<string, unknown>>(req: Request, row: T, fields: string[]) => (can(req, 'purchase.view_value') ? row : Object.fromEntries(Object.entries(row).map(([k, v]) => [k, fields.includes(k) ? null : v])) as T);

// ============================ ĐỀ NGHỊ MUA HÀNG ============================
const prSchema = z.object({
  client_request_id: z.string().max(64).optional(),
  request_date: z.coerce.date(),
  department_id: z.coerce.number().int().positive('Chọn bộ phận đề nghị'),
  purpose: z.string().trim().min(5, 'Ghi rõ mục đích mua'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  needed_date: zOptDate, note: zOptStr,
  lines: z.array(z.object({
    item_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(), chemical_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    description: zOptStr, qty: z.coerce.number().positive('SL phải > 0'), unit_code: zOptStr, needed_date: zOptDate, note: zOptStr,
  }).refine((l) => !!l.item_id !== !!l.chemical_id, 'Mỗi dòng chọn MỘT vật tư hoặc MỘT hóa chất')).min(1, 'Phải có ít nhất 1 dòng'),
});

const prInclude = {
  department: { select: { id: true, code: true, name: true } },
  requester: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } }, chemical: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } } },
} satisfies Prisma.PurchaseRequestInclude;

function prScope(req: Request): Prisma.PurchaseRequestWhereInput {
  if (can(req, 'purchase.order') || can(req, 'purchase.request_approve') || can(req, 'purchase.order_approve')) return {};
  return { OR: [{ requester_id: req.user!.id }, ...(req.user!.department_id ? [{ department_id: req.user!.department_id }] : [])] };
}

/** Gợi ý đề nghị mua: vật tư & hóa chất dưới mức tối thiểu (chưa có đề nghị/đơn đang mở) */
prRouter.get('/suggestions', requirePerm('purchase.request'), async (_req, res) => {
  const now = new Date();
  const { rows } = await queryNxt({ from: now, to: now });
  const open = await prisma.purchaseRequestItem.findMany({ where: { request: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } } }, select: { item_id: true, chemical_id: true } });
  const openPo = await prisma.purchaseOrderItem.findMany({ where: { order: { status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'SENT', 'PARTIAL'] } } }, select: { item_id: true, chemical_id: true, qty_ordered: true, qty_received: true } });
  const items = rows.filter((x) => x.min_stock > 0 && x.available < x.min_stock).map((x) => {
    const onOrder = openPo.filter((p) => p.item_id === x.item_id).reduce((s, p) => s + Number(p.qty_ordered) - Number(p.qty_received), 0);
    return { type: 'item', id: x.item_id, code: x.code, name: x.name, unit: x.unit, available: x.available, min_stock: x.min_stock, max_stock: x.max_stock, on_order: onOrder, in_open_request: open.some((o) => o.item_id === x.item_id), suggest_qty: Math.max(0, (x.max_stock ?? x.min_stock * 2) - x.available - onOrder) };
  }).filter((x) => x.suggest_qty > 0);
  const chems = await prisma.chemical.findMany({ where: { status: 'ACTIVE', min_stock: { gt: 0 } }, include: { unit: true } });
  const whs = await prisma.warehouse.findMany({ where: { type: 'CHEMICAL', status: 'ACTIVE' } });
  const chemRows = [];
  for (const c of chems) {
    let avail = 0;
    for (const w of whs) avail += Number((await chemAvailability(prisma, w.id, [c.id])).get(c.id)!.available);
    const onOrder = openPo.filter((p) => p.chemical_id === c.id).reduce((s, p) => s + Number(p.qty_ordered) - Number(p.qty_received), 0);
    if (avail < Number(c.min_stock)) chemRows.push({ type: 'chemical', id: c.id, code: c.code, name: c.name, unit: c.unit.code, available: avail, min_stock: Number(c.min_stock), max_stock: null, on_order: onOrder, in_open_request: open.some((o) => o.chemical_id === c.id), suggest_qty: Math.max(0, Number(c.min_stock) * 2 - avail - onOrder) });
  }
  ok(res, [...items, ...chemRows.filter((x) => x.suggest_qty > 0)]);
});

prRouter.get('/', requirePerm('purchase.view', 'purchase.request'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.PurchaseRequestWhereInput[] = [prScope(req)];
  if (req.query.q) and.push({ OR: [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { purpose: { contains: String(req.query.q), mode: 'insensitive' } }] });
  if (req.query.status) and.push({ status: String(req.query.status) as 'DRAFT' });
  if (req.query.from) and.push({ request_date: { gte: new Date(String(req.query.from)) } });
  if (req.query.to) and.push({ request_date: { lte: new Date(String(req.query.to)) } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.purchaseRequest.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { department: { select: { name: true } }, requester: { select: { full_name: true } }, _count: { select: { lines: true, quotes: true } } } }),
    prisma.purchaseRequest.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

prRouter.get('/:id', requirePerm('purchase.view', 'purchase.request'), async (req, res) => {
  const pr = await prisma.purchaseRequest.findFirst({ where: { id: Number(req.params.id), ...prScope(req) }, include: { ...prInclude, quotes: { include: { supplier: { select: { id: true, code: true, name: true } }, lines: true } } } });
  if (!pr) throw notFound('Không tìm thấy đề nghị mua');
  const pos = await prisma.purchaseOrder.findMany({ where: { request_id: pr.id }, select: { id: true, code: true, status: true, supplier: { select: { name: true } } } });
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: 'purchase_request', entity_id: pr.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  const showVal = can(req, 'purchase.view_value');
  ok(res, { ...pr, quotes: pr.quotes.map((q) => ({ ...q, lines: q.lines.map((l) => ({ ...l, unit_price: showVal ? l.unit_price : null })) })), orders: pos, history: hist });
});

async function validatePr(req: Request, d: z.infer<typeof prSchema>) {
  if (!(can(req, 'purchase.order') || can(req, 'purchase.request_approve')) && d.department_id !== req.user!.department_id && req.user!.department_id) throw forbidden('Chỉ được lập đề nghị cho bộ phận của mình');
  const dept = await prisma.department.findUnique({ where: { id: d.department_id } });
  if (!dept || dept.status !== 'ACTIVE') throw badRequest('Bộ phận không hợp lệ');
}
const prLines = (d: z.infer<typeof prSchema>) => d.lines.map((l, i) => ({ ...l, item_id: l.item_id ?? null, chemical_id: l.chemical_id ?? null, line_no: i + 1, needed_date: l.needed_date ? toDateOnly(l.needed_date) : null }));

prRouter.post('/', requirePerm('purchase.request'), async (req, res) => {
  const d = prSchema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.purchaseRequest.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validatePr(req, d);
  const pr = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.PURCHASE_REQUEST, d.request_date);
    const { lines: _l, ...head } = d;
    const c = await tx.purchaseRequest.create({ data: { ...head, code, request_date: toDateOnly(d.request_date), needed_date: d.needed_date ? toDateOnly(d.needed_date) : null, requester_id: req.user!.id, created_by: req.user!.id, lines: { create: prLines(d) } } });
    await history(tx, 'purchase_request', c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', 'purchase_request', c, undefined, d, tx);
    return c;
  });
  ok(res, pr);
});

prRouter.put('/:id', requirePerm('purchase.request'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.purchaseRequest.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa');
  const d = prSchema.parse(req.body);
  await validatePr(req, d);
  await withTx(async (tx) => {
    await transition(tx, 'purchaseRequest', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.purchaseRequestItem.deleteMany({ where: { request_id: id } });
    const { lines: _l, client_request_id: _c, ...head } = d;
    await tx.purchaseRequest.update({ where: { id }, data: { ...head, request_date: toDateOnly(d.request_date), needed_date: d.needed_date ? toDateOnly(d.needed_date) : null, status: 'DRAFT', lines: { create: prLines(d) } } });
    await audit(req, 'UPDATE', 'purchase_request', before, before, d, tx);
  });
  ok(res, { id });
});

async function prAction(req: Request, id: number, from: string[], to: string, action: string, extra: Record<string, unknown> = {}, comment?: string | null) {
  const pr = await prisma.purchaseRequest.findUnique({ where: { id } });
  if (!pr) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'purchaseRequest', id, from as never, { status: to, ...extra });
    await history(tx, 'purchase_request', id, action, req.user!.id, pr.status, to, comment);
    await audit(req, action, 'purchase_request', pr, { status: pr.status }, { status: to, comment }, tx);
    if (action === 'SUBMIT') await notifyPermission(tx, ['purchase.request_approve'], req.user!.id, { type: 'APPROVAL', title: `Đề nghị mua ${pr.code} chờ duyệt`, message: pr.purpose, link: `/purchase-requests/${id}` });
    if (action === 'APPROVE') { await notifyUsers(tx, [pr.requester_id], { type: 'INFO', title: `Đề nghị mua ${pr.code} đã được duyệt`, link: `/purchase-requests/${id}` }); await notifyPermission(tx, ['purchase.order'], req.user!.id, { type: 'TASK', title: `Đề nghị mua ${pr.code} đã duyệt – chờ lập báo giá / PO`, link: `/purchase-requests/${id}` }); }
    if (action === 'REJECT') await notifyUsers(tx, [pr.requester_id], { type: 'WARNING', title: `Đề nghị mua ${pr.code} bị từ chối`, message: comment ?? '', link: `/purchase-requests/${id}` });
  });
  return pr;
}

prRouter.post('/:id/submit', requirePerm('purchase.request'), async (req, res) => {
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: Number(req.params.id) } });
  if (pr?.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được gửi duyệt');
  await prAction(req, Number(req.params.id), ['DRAFT', 'REJECTED'], 'SUBMITTED', 'SUBMIT', { submitted_at: new Date(), reject_reason: null });
  ok(res, { status: 'SUBMITTED' });
});
prRouter.post('/:id/approve', requirePerm('purchase.request_approve'), async (req, res) => {
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: Number(req.params.id) } });
  if (!pr) throw notFound();
  assertNotSelf(req, [pr.created_by, pr.requester_id]);
  await prAction(req, pr.id, ['SUBMITTED'], 'APPROVED', 'APPROVE', { approved_by: req.user!.id, approved_at: new Date() }, comment);
  ok(res, { status: 'APPROVED' });
});
prRouter.post('/:id/reject', requirePerm('purchase.request_approve'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: Number(req.params.id) } });
  if (!pr) throw notFound();
  assertNotSelf(req, [pr.created_by, pr.requester_id], 'từ chối');
  await prAction(req, pr.id, ['SUBMITTED'], 'REJECTED', 'REJECT', { reject_reason: reason }, reason);
  ok(res, { status: 'REJECTED' });
});
prRouter.post('/:id/cancel', requirePerm('purchase.request', 'purchase.request_approve'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const id = Number(req.params.id);
  if (await prisma.purchaseOrder.count({ where: { request_id: id, status: { notIn: ['CANCELLED'] } } })) throw ruleViolation('Đề nghị đã có đơn đặt hàng – hủy đơn đặt hàng trước');
  await prAction(req, id, ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'], 'CANCELLED', 'CANCEL', { cancel_reason: reason }, reason);
  ok(res, { status: 'CANCELLED' });
});
prRouter.post('/:id/close', requirePerm('purchase.order'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  await prAction(req, Number(req.params.id), ['APPROVED', 'ORDERED'], 'CLOSED', 'CLOSE', {}, reason);
  ok(res, { status: 'CLOSED' });
});

/** So sánh báo giá của đề nghị */
prRouter.get('/:id/compare', requirePerm('purchase.view', 'purchase.request'), async (req, res) => {
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: Number(req.params.id) }, include: { lines: { include: { item: { select: { code: true, name: true } }, chemical: { select: { code: true, name: true } } } }, quotes: { include: { supplier: true, lines: true } } } });
  if (!pr) throw notFound();
  const showVal = can(req, 'purchase.view_value');
  const quotes = pr.quotes.filter((q) => q.status !== 'REQUESTED');
  ok(res, {
    quotes: quotes.map((q) => ({ id: q.id, code: q.code, supplier: q.supplier.name, supplier_id: q.supplier_id, currency: q.currency, delivery_days: q.delivery_days, payment_terms: q.payment_terms, valid_until: q.valid_until, status: q.status,
      total: showVal ? q.lines.reduce((s, l) => s + Number(l.unit_price ?? 0) * Number(l.qty), 0) : null })),
    lines: pr.lines.map((l) => {
      const prices = quotes.map((q) => ({ quote_id: q.id, price: q.lines.find((x) => x.pr_item_id === l.id)?.unit_price ?? null }));
      const valid = prices.filter((p) => p.price != null).map((p) => Number(p.price));
      return { id: l.id, label: l.item ? `${l.item.code} – ${l.item.name}` : l.chemical ? `${l.chemical.code} – ${l.chemical.name}` : l.description, qty: l.qty, prices: showVal ? prices : prices.map((p) => ({ ...p, price: null })), best: showVal && valid.length ? Math.min(...valid) : null };
    }),
  });
});

// ============================ YÊU CẦU BÁO GIÁ ============================
quotesRouter.post('/', requirePerm('purchase.order'), async (req, res) => {
  const d = z.object({ request_id: z.coerce.number().int().positive(), supplier_ids: z.array(z.coerce.number().int().positive()).min(1, 'Chọn ít nhất 1 nhà cung cấp'), note: zOptStr }).parse(req.body);
  const pr = await prisma.purchaseRequest.findUnique({ where: { id: d.request_id }, include: { lines: true } });
  if (!pr) throw notFound();
  if (!['APPROVED', 'ORDERED'].includes(pr.status)) throw ruleViolation('Chỉ lập yêu cầu báo giá cho đề nghị mua đã được duyệt');
  const created = await withTx(async (tx) => {
    const out = [];
    for (const sid of [...new Set(d.supplier_ids)]) {
      const code = await nextDocNo(tx, DOC_PREFIX.QUOTE);
      out.push(await tx.supplierQuote.create({ data: { code, request_id: pr.id, supplier_id: sid, requested_at: toDateOnly(new Date()), note: d.note, created_by: req.user!.id, lines: { create: pr.lines.map((l) => ({ pr_item_id: l.id, item_id: l.item_id, chemical_id: l.chemical_id, qty: l.qty })) } } }));
    }
    await audit(req, 'CREATE', 'supplier_quote', { code: pr.code }, undefined, d, tx);
    return out;
  });
  ok(res, created);
});

quotesRouter.get('/', requirePerm('purchase.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.SupplierQuoteWhereInput = {
    ...(req.query.status ? { status: String(req.query.status) } : {}),
    ...(req.query.q ? { OR: [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { quote_no: { contains: String(req.query.q), mode: 'insensitive' } }, { supplier: { name: { contains: String(req.query.q), mode: 'insensitive' } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.supplierQuote.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { supplier: { select: { name: true } }, request: { select: { id: true, code: true } }, lines: { select: { qty: true, unit_price: true } } } }),
    prisma.supplierQuote.count({ where }),
  ]);
  const showVal = can(req, 'purchase.view_value');
  ok(res, rows.map(({ lines, ...q }) => ({ ...q, line_count: lines.length, total: showVal ? lines.reduce((s, l) => s + Number(l.unit_price ?? 0) * Number(l.qty), 0) : null })), pageMeta(page, pageSize, total));
});

quotesRouter.get('/:id', requirePerm('purchase.view'), async (req, res) => {
  const q = await prisma.supplierQuote.findUnique({ where: { id: Number(req.params.id) }, include: { supplier: true, request: { include: { lines: { include: { item: { select: { code: true, name: true, unit: { select: { code: true } } } }, chemical: { select: { code: true, name: true, unit: { select: { code: true } } } } } } } }, lines: true } });
  if (!q) throw notFound();
  const showVal = can(req, 'purchase.view_value');
  ok(res, { ...q, lines: q.lines.map((l) => ({ ...l, unit_price: showVal ? l.unit_price : null })) });
});

/** Nhập nội dung báo giá nhận được từ NCC */
quotesRouter.put('/:id', requirePerm('purchase.order'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    quote_no: zOptStr, quote_date: z.coerce.date(), valid_until: zOptDate, currency: z.string().trim().min(3, 'Chọn tiền tệ').max(10),
    delivery_days: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().min(0)]).optional(), payment_terms: zOptStr, note: zOptStr,
    lines: z.array(z.object({ id: z.coerce.number(), unit_price: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().min(0)]) })),
  }).parse(req.body);
  const q = await prisma.supplierQuote.findUnique({ where: { id } });
  if (!q) throw notFound();
  if (['SELECTED'].includes(q.status)) throw ruleViolation('Báo giá đã được chọn để lập PO – không sửa');
  await withTx(async (tx) => {
    const { lines, ...head } = d;
    await tx.supplierQuote.update({ where: { id }, data: { ...head, quote_date: toDateOnly(d.quote_date), valid_until: d.valid_until ? toDateOnly(d.valid_until) : null, status: 'RECEIVED' } });
    for (const l of lines) await tx.supplierQuoteItem.updateMany({ where: { id: l.id, quote_id: id }, data: { unit_price: l.unit_price } });
    await audit(req, 'UPDATE', 'supplier_quote', q, undefined, d, tx);
  });
  ok(res, { id });
});

quotesRouter.post('/:id/reject', requirePerm('purchase.order'), async (req, res) => {
  const q = await prisma.supplierQuote.update({ where: { id: Number(req.params.id) }, data: { status: 'REJECTED' } });
  await audit(req, 'REJECT', 'supplier_quote', q);
  ok(res, q);
});

// ============================ ĐƠN ĐẶT HÀNG ============================
const poSchema = z.object({
  client_request_id: z.string().max(64).optional(),
  supplier_id: z.coerce.number().int().positive('Chọn nhà cung cấp'),
  request_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  quote_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  order_date: z.coerce.date(), expected_date: zOptDate,
  currency: z.string().trim().min(3, 'Chọn tiền tệ').max(10), exchange_rate: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().positive()]).optional(),
  payment_terms: zOptStr, delivery_terms: zOptStr, note: zOptStr,
  lines: z.array(z.object({
    pr_item_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    item_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(), chemical_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    description: zOptStr, qty_ordered: z.coerce.number().positive('SL đặt phải > 0'), unit_price: z.coerce.number().min(0, 'Đơn giá không âm'), note: zOptStr,
  }).refine((l) => !!l.item_id !== !!l.chemical_id, 'Mỗi dòng chọn MỘT vật tư hoặc MỘT hóa chất')).min(1),
});

const poInclude = {
  supplier: { select: { id: true, code: true, name: true, payment_terms: true } },
  creator: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } }, chemical: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } } } },
} satisfies Prisma.PurchaseOrderInclude;

const today0 = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };

poRouter.get('/', requirePerm('purchase.view', 'receipts.create', 'chemicals.receipt_create'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.PurchaseOrderWhereInput[] = [];
  if (req.query.q) and.push({ OR: [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { supplier: { name: { contains: String(req.query.q), mode: 'insensitive' } } }] });
  if (req.query.status) and.push({ status: { in: String(req.query.status).split(',') as 'DRAFT'[] } });
  if (req.query.supplier_id) and.push({ supplier_id: Number(req.query.supplier_id) });
  if (req.query.late === '1') and.push({ status: { in: ['APPROVED', 'SENT', 'PARTIAL'] }, expected_date: { lt: today0() } });
  if (req.query.receivable === '1') and.push({ status: { in: ['APPROVED', 'SENT', 'PARTIAL'] } });
  if (req.query.kind === 'item') and.push({ lines: { some: { item_id: { not: null } } } });
  if (req.query.kind === 'chemical') and.push({ lines: { some: { chemical_id: { not: null } } } });
  if (req.query.from) and.push({ order_date: { gte: new Date(String(req.query.from)) } });
  if (req.query.to) and.push({ order_date: { lte: new Date(String(req.query.to)) } });
  const where = and.length ? { AND: and } : {};
  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { supplier: { select: { name: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.purchaseOrder.count({ where }),
  ]);
  const t = today0();
  ok(res, rows.map((r) => ({ ...hidePrices(req, r as unknown as Record<string, unknown>, ['total_amount']), is_late: !!r.expected_date && r.expected_date < t && ['APPROVED', 'SENT', 'PARTIAL'].includes(r.status) })), pageMeta(page, pageSize, total));
});

poRouter.get('/:id', requirePerm('purchase.view', 'receipts.create', 'chemicals.receipt_create'), async (req, res) => {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: Number(req.params.id) }, include: poInclude });
  if (!po) throw notFound('Không tìm thấy đơn đặt hàng');
  const [receipts, chemReceipts, hist, pr] = await Promise.all([
    prisma.stockReceipt.findMany({ where: { purchase_order_id: po.id }, select: { id: true, code: true, status: true, doc_date: true, posted_at: true } }),
    prisma.chemicalReceipt.findMany({ where: { purchase_order_id: po.id }, select: { id: true, code: true, status: true, doc_date: true, posted_at: true } }),
    prisma.approvalHistory.findMany({ where: { entity_type: 'purchase_order', entity_id: po.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } }),
    po.request_id ? prisma.purchaseRequest.findUnique({ where: { id: po.request_id }, select: { id: true, code: true } }) : null,
  ]);
  const t = today0();
  const showVal = can(req, 'purchase.view_value');
  ok(res, {
    ...po, total_amount: showVal ? po.total_amount : null, request: pr, receipts, chem_receipts: chemReceipts, history: hist,
    is_late: !!po.expected_date && po.expected_date < t && ['APPROVED', 'SENT', 'PARTIAL'].includes(po.status),
    lines: po.lines.map((l) => ({ ...l, unit_price: showVal ? l.unit_price : null, amount: showVal ? l.amount : null, remaining: Number(l.qty_ordered.minus(l.qty_received)) })),
  });
});

async function validatePo(d: z.infer<typeof poSchema>) {
  const sup = await prisma.supplier.findUnique({ where: { id: d.supplier_id } });
  if (!sup || sup.status !== 'ACTIVE') throw badRequest('Nhà cung cấp không tồn tại hoặc đã khóa');
  if (['SUSPENDED', 'STOPPED'].includes(sup.cooperation_status)) throw ruleViolation(`Nhà cung cấp ${sup.name} đang ở trạng thái ${sup.cooperation_status === 'STOPPED' ? 'ngừng hợp tác' : 'tạm ngưng'} – không được đặt hàng`);
  if (d.expected_date && d.expected_date < d.order_date) throw badRequest('Ngày giao dự kiến phải sau ngày đặt hàng');
  if (d.request_id) {
    const pr = await prisma.purchaseRequest.findUnique({ where: { id: d.request_id }, include: { lines: true } });
    if (!pr || !['APPROVED', 'ORDERED'].includes(pr.status)) throw ruleViolation('Đề nghị mua chưa được duyệt – không lập đơn đặt hàng');
    for (const l of d.lines) if (l.pr_item_id && !pr.lines.some((x) => x.id === l.pr_item_id)) throw badRequest('Dòng không thuộc đề nghị mua đã chọn');
  }
  if (d.quote_id) {
    const q = await prisma.supplierQuote.findUnique({ where: { id: d.quote_id } });
    if (!q || q.supplier_id !== d.supplier_id) throw badRequest('Báo giá không thuộc nhà cung cấp đã chọn');
  }
  const minQuotes = Number((await getSettings())['purchase.require_quote_count'] ?? 0);
  if (minQuotes > 0 && d.request_id) {
    const n = await prisma.supplierQuote.count({ where: { request_id: d.request_id, status: { in: ['RECEIVED', 'SELECTED'] } } });
    if (n < minQuotes) throw ruleViolation(`Chính sách yêu cầu tối thiểu ${minQuotes} báo giá trước khi lập PO (hiện có ${n}).`);
  }
}
const poLines = (d: z.infer<typeof poSchema>) => d.lines.map((l, i) => ({ ...l, item_id: l.item_id ?? null, chemical_id: l.chemical_id ?? null, pr_item_id: l.pr_item_id ?? null, line_no: i + 1, amount: D(l.qty_ordered).times(l.unit_price) }));

poRouter.post('/', requirePerm('purchase.order'), async (req, res) => {
  const d = poSchema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.purchaseOrder.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validatePo(d);
  const po = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.PURCHASE_ORDER, d.order_date);
    const lines = poLines(d);
    const { lines: _l, ...head } = d;
    const c = await tx.purchaseOrder.create({ data: { ...head, code, order_date: toDateOnly(d.order_date), expected_date: d.expected_date ? toDateOnly(d.expected_date) : null, total_amount: lines.reduce((s, l) => s.plus(l.amount), D(0)), created_by: req.user!.id, lines: { create: lines } } });
    if (d.quote_id) {
      await tx.supplierQuote.update({ where: { id: d.quote_id }, data: { status: 'SELECTED' } });
      if (d.request_id) await tx.supplierQuote.updateMany({ where: { request_id: d.request_id, id: { not: d.quote_id }, status: { in: ['REQUESTED', 'RECEIVED'] } }, data: { status: 'REJECTED' } });
    }
    await history(tx, 'purchase_order', c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', 'purchase_order', c, undefined, d, tx);
    return c;
  });
  ok(res, po);
});

poRouter.put('/:id', requirePerm('purchase.order'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa');
  const d = poSchema.parse(req.body);
  await validatePo(d);
  await withTx(async (tx) => {
    await transition(tx, 'purchaseOrder', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.purchaseOrderItem.deleteMany({ where: { order_id: id } });
    const lines = poLines(d);
    const { lines: _l, client_request_id: _c, ...head } = d;
    await tx.purchaseOrder.update({ where: { id }, data: { ...head, order_date: toDateOnly(d.order_date), expected_date: d.expected_date ? toDateOnly(d.expected_date) : null, total_amount: lines.reduce((s, l) => s.plus(l.amount), D(0)), status: 'DRAFT', lines: { create: lines } } });
    await audit(req, 'UPDATE', 'purchase_order', before, before, d, tx);
  });
  ok(res, { id });
});

async function poAction(req: Request, id: number, from: string[], to: string, action: string, extra: Record<string, unknown> = {}, comment?: string | null) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'purchaseOrder', id, from as never, { status: to, ...extra });
    if (action === 'APPROVE' && po.request_id) await tx.purchaseRequest.updateMany({ where: { id: po.request_id, status: 'APPROVED' }, data: { status: 'ORDERED' } });
    await history(tx, 'purchase_order', id, action, req.user!.id, po.status, to, comment);
    await audit(req, action, 'purchase_order', po, { status: po.status }, { status: to, comment }, tx);
    if (action === 'SUBMIT') await notifyPermission(tx, ['purchase.order_approve'], req.user!.id, { type: 'APPROVAL', title: `Đơn đặt hàng ${po.code} chờ duyệt`, link: `/purchase-orders/${id}` });
    if (['APPROVE', 'REJECT'].includes(action)) await notifyUsers(tx, [po.created_by], { type: action === 'APPROVE' ? 'INFO' : 'WARNING', title: `Đơn đặt hàng ${po.code} ${action === 'APPROVE' ? 'đã được duyệt' : 'bị từ chối'}`, message: comment ?? '', link: `/purchase-orders/${id}` });
    if (action === 'SEND') await notifyPermission(tx, ['receipts.create', 'chemicals.receipt_create'], req.user!.id, { type: 'INFO', title: `PO ${po.code} đã gửi NCC – chờ giao hàng`, link: `/purchase-orders/${id}` });
  });
}

poRouter.post('/:id/submit', requirePerm('purchase.order'), async (req, res) => { await poAction(req, Number(req.params.id), ['DRAFT', 'REJECTED'], 'SUBMITTED', 'SUBMIT', { submitted_at: new Date(), reject_reason: null }); ok(res, { status: 'SUBMITTED' }); });
poRouter.post('/:id/approve', requirePerm('purchase.order_approve'), async (req, res) => {
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const po = await prisma.purchaseOrder.findUnique({ where: { id: Number(req.params.id) } });
  if (!po) throw notFound();
  assertNotSelf(req, [po.created_by]);
  await poAction(req, po.id, ['SUBMITTED'], 'APPROVED', 'APPROVE', { approved_by: req.user!.id, approved_at: new Date() }, comment);
  ok(res, { status: 'APPROVED' });
});
poRouter.post('/:id/reject', requirePerm('purchase.order_approve'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const po = await prisma.purchaseOrder.findUnique({ where: { id: Number(req.params.id) } });
  if (!po) throw notFound();
  assertNotSelf(req, [po.created_by], 'từ chối');
  await poAction(req, po.id, ['SUBMITTED'], 'REJECTED', 'REJECT', { reject_reason: reason }, reason);
  ok(res, { status: 'REJECTED' });
});
poRouter.post('/:id/send', requirePerm('purchase.order'), async (req, res) => { await poAction(req, Number(req.params.id), ['APPROVED'], 'SENT', 'SEND', { sent_at: new Date() }); ok(res, { status: 'SENT' }); });
poRouter.post('/:id/close', requirePerm('purchase.order'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do đóng đơn') }).parse(req.body);
  const id = Number(req.params.id);
  const pending = await prisma.stockReceipt.count({ where: { purchase_order_id: id, status: { in: ['DRAFT', 'SUBMITTED'] } } }) + await prisma.chemicalReceipt.count({ where: { purchase_order_id: id, status: { in: ['DRAFT', 'SUBMITTED'] } } });
  if (pending) throw ruleViolation('Còn phiếu nhập kho liên kết chưa xử lý xong – không đóng đơn');
  await poAction(req, id, ['PARTIAL', 'RECEIVED', 'SENT', 'APPROVED'], 'CLOSED', 'CLOSE', { close_reason: reason }, reason);
  ok(res, { status: 'CLOSED' });
});
poRouter.post('/:id/cancel', requirePerm('purchase.order'), async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do hủy') }).parse(req.body);
  const id = Number(req.params.id);
  const received = await prisma.purchaseOrderItem.count({ where: { order_id: id, qty_received: { gt: 0 } } });
  if (received) throw ruleViolation('Đơn đã nhận hàng (một phần) – không hủy được, hãy dùng "Đóng đơn"');
  const linked = await prisma.stockReceipt.count({ where: { purchase_order_id: id, status: { in: ['DRAFT', 'SUBMITTED'] } } }) + await prisma.chemicalReceipt.count({ where: { purchase_order_id: id, status: { in: ['DRAFT', 'SUBMITTED'] } } });
  if (linked) throw ruleViolation('Còn phiếu nhập kho đang liên kết – hủy phiếu nhập trước');
  await poAction(req, id, ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED', 'SENT'], 'CANCELLED', 'CANCEL', { cancel_reason: reason }, reason);
  ok(res, { status: 'CANCELLED' });
});

// ============================ NHÀ CUNG CẤP: hồ sơ, thống kê, so sánh, đánh giá, khiếu nại ============================
export async function supplierStats(supplierId: number, from?: Date, to?: Date) {
  const range = Prisma.sql`${from ? Prisma.sql`AND po.order_date >= ${from}` : Prisma.empty} ${to ? Prisma.sql`AND po.order_date <= ${to}` : Prisma.empty}`;
  const [po] = await prisma.$queryRaw<{ n: number; value: number; completed: number; on_time: number }[]>`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(po.total_amount),0)::float AS value,
      COUNT(*) FILTER (WHERE po.completed_at IS NOT NULL)::int AS completed,
      COUNT(*) FILTER (WHERE po.completed_at IS NOT NULL AND (po.expected_date IS NULL OR po.completed_at::date <= po.expected_date))::int AS on_time
    FROM purchase_orders po WHERE po.supplier_id = ${supplierId} AND po.status NOT IN ('DRAFT','CANCELLED','REJECTED') ${range}`;
  const [rc] = await prisma.$queryRaw<{ lines: number; short_lines: number; received: number; rejected: number; receipts: number }[]>`
    SELECT COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE l.qty_received < l.qty_doc)::int AS short_lines,
      COALESCE(SUM(l.qty_received),0)::float AS received, COALESCE(SUM(l.qty_rejected),0)::float AS rejected, COUNT(DISTINCT r.id)::int AS receipts
    FROM stock_receipt_items l JOIN stock_receipts r ON r.id = l.receipt_id WHERE r.supplier_id = ${supplierId} AND r.status = 'POSTED'
      ${from ? Prisma.sql`AND r.posted_at >= ${from}` : Prisma.empty} ${to ? Prisma.sql`AND r.posted_at <= ${to}` : Prisma.empty}`;
  const [ch] = await prisma.$queryRaw<{ lines: number; short_lines: number; failed: number; received: number; receipts: number }[]>`
    SELECT COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE l.qty_received < l.qty_doc)::int AS short_lines,
      COALESCE(SUM(l.qty_received) FILTER (WHERE l.result <> 'PASSED'),0)::float AS failed, COALESCE(SUM(l.qty_received),0)::float AS received, COUNT(DISTINCT r.id)::int AS receipts
    FROM chemical_receipt_items l JOIN chemical_receipts r ON r.id = l.receipt_id WHERE r.supplier_id = ${supplierId} AND r.status = 'POSTED'`;
  const complaints = await prisma.supplierComplaint.count({ where: { supplier_id: supplierId } });
  const lines = rc.lines + ch.lines;
  const received = rc.received + ch.received;
  return {
    po_count: po.n, po_value: po.value, po_completed: po.completed,
    on_time_rate: po.completed ? Math.round((po.on_time / po.completed) * 1000) / 10 : null,
    receipt_count: rc.receipts + ch.receipts,
    shortage_rate: lines ? Math.round(((rc.short_lines + ch.short_lines) / lines) * 1000) / 10 : null,
    defect_rate: received ? Math.round(((rc.rejected + ch.failed) / received) * 1000) / 10 : null,
    complaints,
  };
}

supplierExtraRouter.get('/need-evaluation', requirePerm('suppliers.view'), async (_req, res) => {
  const since = new Date(Date.now() - 180 * 86400_000);
  const active = await prisma.purchaseOrder.findMany({ where: { order_date: { gte: since }, status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] } }, select: { supplier_id: true }, distinct: ['supplier_id'] });
  const evaluated = await prisma.supplierEvaluation.findMany({ where: { created_at: { gte: since } }, select: { supplier_id: true }, distinct: ['supplier_id'] });
  const ids = active.map((a) => a.supplier_id).filter((id) => !evaluated.some((e) => e.supplier_id === id));
  ok(res, await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }));
});

supplierExtraRouter.get('/compare', requirePerm('suppliers.view'), async (req, res) => {
  const itemId = Number(req.query.item_id) || 0;
  const chemId = Number(req.query.chemical_id) || 0;
  if (!itemId && !chemId) throw badRequest('Chọn vật tư hoặc hóa chất để so sánh');
  const rows = await prisma.$queryRaw<{ supplier_id: number; code: string; name: string; orders: number; last_price: number; avg_price: number; min_price: number; last_order: Date; currency: string | null; avg_lead_days: number | null }[]>`
    SELECT s.id AS supplier_id, s.code, s.name, COUNT(DISTINCT po.id)::int AS orders,
      (ARRAY_AGG(l.unit_price ORDER BY po.order_date DESC))[1]::float AS last_price, AVG(l.unit_price)::float AS avg_price, MIN(l.unit_price)::float AS min_price,
      MAX(po.order_date) AS last_order, (ARRAY_AGG(po.currency ORDER BY po.order_date DESC))[1] AS currency,
      AVG(EXTRACT(EPOCH FROM (po.completed_at - po.order_date::timestamp)) / 86400) FILTER (WHERE po.completed_at IS NOT NULL)::float AS avg_lead_days
    FROM purchase_order_items l JOIN purchase_orders po ON po.id = l.order_id JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status NOT IN ('DRAFT','CANCELLED','REJECTED') AND (${itemId}::int = 0 OR l.item_id = ${itemId}::int) AND (${chemId}::int = 0 OR l.chemical_id = ${chemId}::int)
    GROUP BY s.id, s.code, s.name ORDER BY avg_price`;
  const quotes = await prisma.$queryRaw<{ supplier_id: number; quotes: number; last_quote_price: number }[]>`
    SELECT q.supplier_id, COUNT(*)::int AS quotes, (ARRAY_AGG(l.unit_price ORDER BY q.quote_date DESC NULLS LAST))[1]::float AS last_quote_price
    FROM supplier_quote_items l JOIN supplier_quotes q ON q.id = l.quote_id
    WHERE l.unit_price IS NOT NULL AND (${itemId}::int = 0 OR l.item_id = ${itemId}::int) AND (${chemId}::int = 0 OR l.chemical_id = ${chemId}::int) GROUP BY q.supplier_id`;
  const ids = [...new Set([...rows.map((r) => r.supplier_id), ...quotes.map((q) => q.supplier_id)])];
  const sups = await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
  const evals = await prisma.supplierEvaluation.findMany({ where: { supplier_id: { in: ids } }, orderBy: { id: 'desc' } });
  const showVal = can(req, 'purchase.view_value');
  const out = [];
  for (const id of ids) {
    const r = rows.find((x) => x.supplier_id === id);
    const q = quotes.find((x) => x.supplier_id === id);
    const st = await supplierStats(id);
    const ev = evals.find((e) => e.supplier_id === id);
    const s = sups.find((x) => x.id === id)!;
    out.push({ supplier_id: id, code: s.code, name: s.name, orders: r?.orders ?? 0, currency: r?.currency ?? null, last_order: r?.last_order ?? null, avg_lead_days: r?.avg_lead_days != null ? Math.round(r.avg_lead_days * 10) / 10 : null,
      last_price: showVal ? r?.last_price ?? null : null, avg_price: showVal ? r?.avg_price ?? null : null, min_price: showVal ? r?.min_price ?? null : null,
      quotes: q?.quotes ?? 0, last_quote_price: showVal ? q?.last_quote_price ?? null : null,
      on_time_rate: st.on_time_rate, defect_rate: st.defect_rate, shortage_rate: st.shortage_rate, last_score: ev ? Number(ev.total_score) : null, classification: ev?.classification ?? null });
  }
  ok(res, out);
});

supplierExtraRouter.get('/:id/profile', requirePerm('suppliers.view'), async (req, res) => {
  const id = Number(req.params.id);
  const s = await prisma.supplier.findUnique({ where: { id } });
  if (!s) throw notFound();
  const [stats, orders, receipts, chemReceipts, evaluations, complaints] = await Promise.all([
    supplierStats(id),
    prisma.purchaseOrder.findMany({ where: { supplier_id: id }, orderBy: { id: 'desc' }, take: 50, select: { id: true, code: true, order_date: true, expected_date: true, status: true, total_amount: true, currency: true, completed_at: true } }),
    prisma.stockReceipt.findMany({ where: { supplier_id: id, status: 'POSTED' }, orderBy: { id: 'desc' }, take: 50, select: { id: true, code: true, doc_date: true, posted_at: true, po_number: true } }),
    prisma.chemicalReceipt.findMany({ where: { supplier_id: id, status: 'POSTED' }, orderBy: { id: 'desc' }, take: 50, select: { id: true, code: true, doc_date: true, posted_at: true } }),
    prisma.supplierEvaluation.findMany({ where: { supplier_id: id }, orderBy: { id: 'desc' } }),
    prisma.supplierComplaint.findMany({ where: { supplier_id: id }, orderBy: { id: 'desc' } }),
  ]);
  const u = await userNames(evaluations.map((e) => e.evaluator_id));
  const showVal = can(req, 'purchase.view_value');
  ok(res, { stats: { ...stats, po_value: showVal ? stats.po_value : null }, orders: orders.map((o) => ({ ...o, total_amount: showVal ? o.total_amount : null })), receipts, chem_receipts: chemReceipts, evaluations: evaluations.map((e) => ({ ...e, evaluator: u.find((x) => x.id === e.evaluator_id)?.full_name })), complaints });
});

supplierExtraRouter.post('/:id/evaluations', requirePerm('suppliers.evaluate'), async (req, res) => {
  const id = Number(req.params.id);
  const sc = z.coerce.number().int().min(1, 'Điểm từ 1–5').max(5, 'Điểm từ 1–5');
  const d = z.object({ period_from: z.coerce.date(), period_to: z.coerce.date(), quality_score: sc, delivery_score: sc, price_score: sc, service_score: sc, comment: zOptStr }).parse(req.body);
  if (d.period_to < d.period_from) throw badRequest('Kỳ đánh giá không hợp lệ');
  const total = Math.round(((d.quality_score * 0.35 + d.delivery_score * 0.3 + d.price_score * 0.2 + d.service_score * 0.15) / 5) * 10000) / 100; // thang 100
  const cls = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D';
  const metrics = await supplierStats(id, d.period_from, d.period_to);
  const e = await prisma.supplierEvaluation.create({ data: { ...d, supplier_id: id, period_from: toDateOnly(d.period_from), period_to: toDateOnly(d.period_to), total_score: total, classification: cls, metrics, evaluator_id: req.user!.id } });
  await audit(req, 'EVALUATE', 'supplier', { id }, undefined, { ...d, total, cls });
  ok(res, e);
});

supplierExtraRouter.post('/:id/complaints', requirePerm('suppliers.evaluate', 'suppliers.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ complaint_date: z.coerce.date(), subject: z.string().trim().min(3, 'Nhập tiêu đề'), description: z.string().trim().min(5, 'Mô tả nội dung'), related_doc: zOptStr }).parse(req.body);
  const c = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.COMPLAINT);
    return tx.supplierComplaint.create({ data: { ...d, code, supplier_id: id, complaint_date: toDateOnly(d.complaint_date), created_by: req.user!.id } });
  });
  await audit(req, 'CREATE', 'supplier_complaint', c, undefined, d);
  ok(res, c);
});

supplierExtraRouter.post('/complaints/:cid/resolve', requirePerm('suppliers.evaluate', 'suppliers.manage'), async (req, res) => {
  const { resolution } = z.object({ resolution: z.string().trim().min(3, 'Nhập kết quả xử lý') }).parse(req.body);
  const c = await prisma.supplierComplaint.update({ where: { id: Number(req.params.cid) }, data: { status: 'CLOSED', resolution, resolved_at: new Date() } });
  await audit(req, 'RESOLVE', 'supplier_complaint', c, undefined, { resolution });
  ok(res, c);
});

export { userNames };
