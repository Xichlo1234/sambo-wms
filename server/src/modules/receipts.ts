/**
 * PHIẾU NHẬP KHO (5.1.2)
 * DRAFT → SUBMITTED → POSTED (duyệt = ghi sổ, tăng tồn) | REJECTED (trả về để sửa) | CANCELLED
 * Mỗi dòng: SL thực nhận = SL đạt (vào tồn khả dụng) + SL chờ kiểm tra (vào kho cách ly) + SL không đạt (không nhập)
 * Nhập thiếu/thừa = SL thực nhận – SL chứng từ (hiển thị cảnh báo, bắt buộc ghi chú).
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, assertNotSelf, can } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission, notifyUsers } from '../lib/notify';
import { postMovements, toDateOnly, assertPeriodOpen, type MoveInput } from '../services/inventory';
import { validatePoLink, applyPoReceipt } from '../services/purchasing';

async function checkPo(d: { purchase_order_id?: number | null; supplier_id?: number | null; lines: { po_item_id?: number | null; item_id: number; qty_received: number; qty_rejected: number }[] }) {
  const po = await validatePoLink(prisma, d.purchase_order_id, d.supplier_id, 'item', d.lines.map((l, i) => ({ po_item_id: l.po_item_id, item_id: l.item_id, qty: l.qty_received - l.qty_rejected, line_no: i + 1 })));
  return po;
}

const r = Router();
const ENTITY = 'stock_receipt';

const lineSchema = z
  .object({
    item_id: z.coerce.number().int().positive('Chọn vật tư'),
    location_id: z.coerce.number().int().positive('Chọn vị trí lưu kho'),
    po_item_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    qty_doc: z.coerce.number().min(0, 'SL chứng từ không âm'),
    qty_received: z.coerce.number().min(0, 'SL thực nhận không âm'),
    qty_pending: z.coerce.number().min(0).default(0),
    qty_rejected: z.coerce.number().min(0).default(0),
    unit_price: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().min(0)]).optional(),
    condition_note: zOptStr,
    note: zOptStr,
  })
  .refine((l) => l.qty_pending + l.qty_rejected <= l.qty_received, {
    message: 'SL chờ kiểm tra + SL không đạt không được lớn hơn SL thực nhận',
  });

const receiptSchema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  doc_date: z.coerce.date({ errorMap: () => ({ message: 'Ngày chứng từ không hợp lệ' }) }),
  received_date: z.union([z.null(), z.literal('').transform(() => null), z.coerce.date()]).optional(),
  supplier_id: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  po_number: zOptStr,
  purchase_order_id: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  supplier_doc_no: zOptStr,
  deliverer_name: zOptStr,
  receiver_name: zOptStr,
  department_id: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  currency: zOptStr,
  exchange_rate: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().positive()]).optional(),
  docs_checked: z.boolean().default(false),
  qty_checked: z.boolean().default(false),
  spec_checked: z.boolean().default(false),
  note: zOptStr,
  lines: z.array(lineSchema).min(1, 'Phiếu nhập phải có ít nhất 1 dòng vật tư'),
});

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  purchase_order: { select: { id: true, code: true } },
  creator: { select: { id: true, full_name: true } },
  approver: { select: { id: true, full_name: true } },
  lines: {
    orderBy: { line_no: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, specification: true, unit: { select: { code: true } } } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.StockReceiptInclude;

function hideValue<T extends { lines: { unit_price: unknown; amount: unknown }[] }>(doc: T, show: boolean): T {
  if (show) return doc;
  return { ...doc, lines: doc.lines.map((l) => ({ ...l, unit_price: null, amount: null })) };
}

async function validateLines(warehouseId: number, lines: z.infer<typeof lineSchema>[]) {
  const wh = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!wh || wh.status !== 'ACTIVE') throw badRequest('Kho không tồn tại hoặc đã khóa');
  if (wh.type !== 'GENERAL') throw badRequest('Kho hóa chất dùng phân hệ Nhập hóa chất riêng (5.2), không dùng phiếu nhập kho mỏ.');
  const itemIds = [...new Set(lines.map((l) => l.item_id))];
  const locIds = [...new Set(lines.map((l) => l.location_id))];
  const [items, locs] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, status: true } }),
    prisma.warehouseLocation.findMany({ where: { id: { in: locIds } }, select: { id: true, warehouse_id: true, status: true, code: true } }),
  ]);
  for (const id of itemIds) {
    const it = items.find((i) => i.id === id);
    if (!it) throw badRequest(`Vật tư ID ${id} không tồn tại`);
    if (it.status !== 'ACTIVE') throw badRequest(`Vật tư ${it.code} đã bị khóa – không thể nhập`);
  }
  for (const id of locIds) {
    const l = locs.find((x) => x.id === id);
    if (!l || l.warehouse_id !== warehouseId) throw badRequest('Vị trí lưu kho không thuộc kho đã chọn');
    if (l.status !== 'ACTIVE') throw badRequest(`Vị trí ${l.code} đã bị khóa`);
  }
  const keys = lines.map((l) => `${l.item_id}:${l.location_id}`);
  if (new Set(keys).size !== keys.length) throw badRequest('Có dòng trùng vật tư + vị trí. Vui lòng gộp thành một dòng.');
}

function buildLines(lines: z.infer<typeof lineSchema>[]) {
  return lines.map((l, i) => {
    const accepted = new Prisma.Decimal(l.qty_received).minus(l.qty_pending).minus(l.qty_rejected);
    return {
      line_no: i + 1,
      item_id: l.item_id,
      location_id: l.location_id,
      po_item_id: l.po_item_id ?? null,
      qty_doc: l.qty_doc,
      qty_received: l.qty_received,
      qty_accepted: accepted,
      qty_pending: l.qty_pending,
      qty_rejected: l.qty_rejected,
      unit_price: l.unit_price ?? null,
      amount: l.unit_price != null ? new Prisma.Decimal(l.unit_price).times(l.qty_received).minus(new Prisma.Decimal(l.unit_price).times(l.qty_rejected)) : null,
      condition_note: l.condition_note,
      note: l.note,
      inspection_status: l.qty_pending > 0 ? ('PENDING' as const) : ('NONE' as const),
    };
  });
}

// ---------- Danh sách ----------
r.get('/', requirePerm('receipts.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.StockReceiptWhereInput = {};
  const q = String(req.query.q || '').trim();
  if (q) where.OR = [{ code: { contains: q, mode: 'insensitive' } }, { po_number: { contains: q, mode: 'insensitive' } }, { supplier_doc_no: { contains: q, mode: 'insensitive' } }, { supplier: { name: { contains: q, mode: 'insensitive' } } }];
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  if (req.query.supplier_id) where.supplier_id = Number(req.query.supplier_id);
  if (req.query.from || req.query.to) where.doc_date = { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}) };
  if (req.query.pending_inspection === '1') where.lines = { some: { inspection_status: 'PENDING' } };
  const [rows, total] = await Promise.all([
    prisma.stockReceipt.findMany({
      where, skip, take, orderBy: [{ doc_date: 'desc' }, { id: 'desc' }],
      include: { supplier: { select: { name: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } },
    }),
    prisma.stockReceipt.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('receipts.view'), async (req, res) => {
  const doc = await prisma.stockReceipt.findUnique({ where: { id: Number(req.params.id) }, include: detailInclude });
  if (!doc) throw notFound('Không tìm thấy phiếu nhập');
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, { ...hideValue(doc, can(req, 'stock.view_value')), history: hist });
});

// ---------- Tạo nháp ----------
r.post('/', requirePerm('receipts.create'), async (req, res) => {
  const d = receiptSchema.parse(req.body);
  if (d.client_request_id) {
    const exist = await prisma.stockReceipt.findUnique({ where: { client_request_id: d.client_request_id } });
    if (exist) return ok(res, exist); // chống tạo trùng do bấm lưu nhiều lần
  }
  await validateLines(d.warehouse_id, d.lines);
  const po = await checkPo(d);
  if (po) { d.po_number = po.code; d.supplier_id = po.supplier_id; }
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.RECEIPT, d.doc_date);
    const { lines, ...head } = d;
    const created = await tx.stockReceipt.create({
      data: {
        ...head, code, doc_date: toDateOnly(d.doc_date), received_date: d.received_date ? toDateOnly(d.received_date) : null,
        receiver_user_id: req.user!.id, created_by: req.user!.id, updated_by: req.user!.id,
        lines: { create: buildLines(lines) },
      },
    });
    await history(tx, ENTITY, created.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, created, undefined, d, tx);
    return created;
  });
  ok(res, doc);
});

// ---------- Sửa nháp ----------
r.put('/:id', requirePerm('receipts.create'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.stockReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!before) throw notFound('Không tìm thấy phiếu nhập');
  if (!['DRAFT', 'REJECTED'].includes(before.status)) throw ruleViolation('Chỉ sửa được phiếu ở trạng thái Nháp hoặc Bị từ chối');
  if (before.created_by !== req.user!.id && !can(req, 'receipts.approve')) throw ruleViolation('Chỉ người lập phiếu được sửa phiếu nháp');
  const d = receiptSchema.parse(req.body);
  await validateLines(d.warehouse_id, d.lines);
  const po = await checkPo(d);
  if (po) { d.po_number = po.code; d.supplier_id = po.supplier_id; }
  const doc = await withTx(async (tx) => {
    await transition(tx, 'stockReceipt', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.stockReceiptItem.deleteMany({ where: { receipt_id: id } });
    const { lines, client_request_id: _c, ...head } = d;
    const updated = await tx.stockReceipt.update({
      where: { id },
      data: {
        ...head, doc_date: toDateOnly(d.doc_date), received_date: d.received_date ? toDateOnly(d.received_date) : null,
        status: 'DRAFT', updated_by: req.user!.id, lines: { create: buildLines(lines) },
      },
    });
    await audit(req, 'UPDATE', ENTITY, updated, before, d, tx);
    return updated;
  });
  ok(res, doc);
});

// ---------- Gửi duyệt ----------
r.post('/:id/submit', requirePerm('receipts.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stockReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  if (!doc.docs_checked || !doc.qty_checked || !doc.spec_checked) {
    throw ruleViolation('Phải hoàn tất kiểm tra chứng từ, số lượng thực tế và quy cách/tình trạng trước khi gửi duyệt (đánh dấu 3 bước kiểm tra trên phiếu).');
  }
  for (const l of doc.lines) {
    if (!l.qty_doc.equals(l.qty_received) && !l.note && !l.condition_note) {
      throw ruleViolation(`Dòng ${l.line_no}: SL thực nhận khác SL chứng từ (nhập ${l.qty_received.lt(l.qty_doc) ? 'thiếu' : 'thừa'}). Bắt buộc ghi chú lý do.`);
    }
    if (l.qty_rejected.gt(0) && !l.condition_note) throw ruleViolation(`Dòng ${l.line_no}: có hàng không đạt – bắt buộc ghi tình trạng hàng hóa.`);
  }
  await assertPeriodOpen(prisma, doc.doc_date);
  await checkPo({ purchase_order_id: doc.purchase_order_id, supplier_id: doc.supplier_id, lines: doc.lines.map((l) => ({ po_item_id: l.po_item_id, item_id: l.item_id, qty_received: Number(l.qty_received), qty_rejected: Number(l.qty_rejected) })) });
  await withTx(async (tx) => {
    await transition(tx, 'stockReceipt', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_by: req.user!.id, submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, doc.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, { status: doc.status }, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['receipts.approve'], req.user!.id, { type: 'APPROVAL', title: `Phiếu nhập ${doc.code} chờ duyệt`, link: `/receipts/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

// ---------- Phê duyệt & ghi sổ ----------
r.post('/:id/approve', requirePerm('receipts.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const doc = await prisma.stockReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by, doc.submitted_by]);
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'stockReceipt', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now, posted_at: now });
    const moves: MoveInput[] = [];
    const base = { warehouse_id: doc.warehouse_id, doc_type: 'RECEIPT', doc_id: doc.id, doc_code: doc.code, doc_date: doc.doc_date, supplier_id: doc.supplier_id, department_id: doc.department_id, movement_type: 'RECEIPT' as const, direction: 'IN' as const };
    for (const l of doc.lines) {
      if (l.qty_accepted.gt(0)) moves.push({ ...base, location_id: l.location_id, item_id: l.item_id, bucket: 'USABLE', qty: l.qty_accepted, doc_line_id: l.id, unit_cost: l.unit_price });
      if (l.qty_pending.gt(0)) moves.push({ ...base, location_id: l.location_id, item_id: l.item_id, bucket: 'QUARANTINE', qty: l.qty_pending, doc_line_id: l.id, unit_cost: l.unit_price, note: 'Hàng chờ kiểm tra' });
    }
    if (!moves.length) throw ruleViolation('Phiếu không có số lượng nào được nhập kho (toàn bộ không đạt). Hãy từ chối hoặc hủy phiếu.');
    await postMovements(tx, req.user!.id, moves);
    await applyPoReceipt(tx, doc.purchase_order_id, doc.lines.map((l) => ({ po_item_id: l.po_item_id, qty: l.qty_accepted.plus(l.qty_pending) })));
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', ENTITY, doc, { status: 'SUBMITTED' }, { status: 'POSTED', movements: moves.length }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'INFO', title: `Phiếu nhập ${doc.code} đã được duyệt & ghi sổ`, link: `/receipts/${id}` });
  });
  ok(res, { id, status: 'POSTED' });
});

r.post('/:id/reject', requirePerm('receipts.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Bắt buộc nhập lý do từ chối') }).parse(req.body);
  const doc = await prisma.stockReceipt.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'stockReceipt', id, ['SUBMITTED'], { status: 'REJECTED', reject_reason: reason, updated_by: req.user!.id });
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, 'SUBMITTED', 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, doc, { status: 'SUBMITTED' }, { status: 'REJECTED', reason }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'WARNING', title: `Phiếu nhập ${doc.code} bị từ chối`, message: reason, link: `/receipts/${id}` });
  });
  ok(res, { id, status: 'REJECTED' });
});

r.post('/:id/cancel', requirePerm('receipts.cancel'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Bắt buộc nhập lý do hủy') }).parse(req.body);
  const doc = await prisma.stockReceipt.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (['POSTED', 'CANCELLED'].includes(doc.status)) throw ruleViolation('Phiếu đã ghi sổ không được hủy. Hãy lập phiếu điều chỉnh nếu có sai sót.');
  await withTx(async (tx) => {
    await transition(tx, 'stockReceipt', id, ['DRAFT', 'SUBMITTED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, { status: doc.status }, { status: 'CANCELLED', reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

// ---------- Xử lý hàng chờ kiểm tra (sau khi ghi sổ) ----------
r.post('/:id/lines/:lineId/inspect', requirePerm('receipts.inspect'), async (req, res) => {
  const id = Number(req.params.id);
  const lineId = Number(req.params.lineId);
  const d = z.object({
    qty_release: z.coerce.number().min(0), // chuyển sang tồn khả dụng
    qty_reject: z.coerce.number().min(0), // chuyển sang hư hỏng/chờ xử lý
    note: z.string().trim().min(3, 'Bắt buộc ghi kết quả kiểm tra'),
  }).parse(req.body);
  const doc = await prisma.stockReceipt.findUnique({ where: { id }, include: { lines: { where: { id: lineId } } } });
  if (!doc || !doc.lines.length) throw notFound();
  if (doc.status !== 'POSTED') throw ruleViolation('Chỉ xử lý hàng chờ kiểm tra của phiếu đã ghi sổ');
  const line = doc.lines[0];
  if (line.inspection_status !== 'PENDING') throw ruleViolation('Dòng này không có hàng chờ kiểm tra');
  if (!new Prisma.Decimal(d.qty_release).plus(d.qty_reject).equals(line.qty_pending)) {
    throw badRequest(`Tổng SL đạt + không đạt phải bằng SL chờ kiểm tra (${line.qty_pending.toString()})`);
  }
  await withTx(async (tx) => {
    const r2 = await tx.stockReceiptItem.updateMany({
      where: { id: lineId, inspection_status: 'PENDING' },
      data: { inspection_status: d.qty_reject > 0 && d.qty_release === 0 ? 'REJECTED' : 'RELEASED', inspected_by: req.user!.id, inspected_at: new Date(), note: [line.note, `KQ kiểm tra: ${d.note}`].filter(Boolean).join(' | ') },
    });
    if (r2.count !== 1) throw ruleViolation('Dòng đã được người khác xử lý');
    const base = { warehouse_id: doc.warehouse_id, location_id: line.location_id, item_id: line.item_id, movement_type: 'INSPECTION' as const, doc_type: 'RECEIPT', doc_id: doc.id, doc_code: doc.code, doc_line_id: line.id, doc_date: toDateOnly(new Date()), note: d.note };
    const moves: MoveInput[] = [{ ...base, bucket: 'QUARANTINE', direction: 'OUT', qty: line.qty_pending }];
    if (d.qty_release > 0) moves.push({ ...base, bucket: 'USABLE', direction: 'IN', qty: d.qty_release, unit_cost: line.unit_price });
    if (d.qty_reject > 0) moves.push({ ...base, bucket: 'DAMAGED', direction: 'IN', qty: d.qty_reject });
    await postMovements(tx, req.user!.id, moves);
    await history(tx, ENTITY, id, 'INSPECT', req.user!.id, null, null, `Dòng ${line.line_no}: đạt ${d.qty_release}, không đạt ${d.qty_reject}. ${d.note}`);
    await audit(req, 'INSPECT', ENTITY, doc, { line_id: lineId, qty_pending: line.qty_pending }, d, tx);
  });
  ok(res, { ok: true });
});

export default r;
