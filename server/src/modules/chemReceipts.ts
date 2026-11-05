/**
 * NHẬP KHO HÓA CHẤT (6.3)
 * DRAFT (Chờ kiểm tra) → SUBMITTED (Chờ phê duyệt) → POSTED (Đã nhập kho)
 *                     ↘ REJECTED (Từ chối tiếp nhận – hàng trả NCC)   ↘ trả về DRAFT để kiểm tra lại
 * Kết quả từng dòng: PASSED (Đạt → lô được phép xuất) | QUARANTINE (Cách ly → lô bị chặn xuất) | FAILED (Không đạt yêu cầu → không nhập kho)
 * Mỗi dòng đạt/cách ly tạo MỘT LÔ RIÊNG – không gộp lô.
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
import { getSettings } from '../lib/settings';
import { toDateOnly, assertPeriodOpen } from '../services/inventory';
import { chemicalWarehouse, chemicalPolicyBlocks, incompatibilityWarnings, postChemMovements, todayUTC, SDS_LABEL } from '../services/chemicals';
import { validatePoLink, applyPoReceipt } from '../services/purchasing';

const r = Router();
const ENTITY = 'chemical_receipt';
const zDateOpt = z.union([z.null(), z.literal('').transform(() => null), z.coerce.date()]).optional();

const schema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho hóa chất'),
  doc_date: z.coerce.date(),
  received_date: z.coerce.date(),
  supplier_id: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  purchase_order_id: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  supplier_doc_no: zOptStr, deliverer_name: zOptStr, transport_note: zOptStr, note: zOptStr,
  chk_packaging: z.boolean().default(false), chk_label: z.boolean().default(false), chk_documents: z.boolean().default(false),
  chk_sds: z.boolean().default(false), chk_transport: z.boolean().default(false),
  lines: z.array(z.object({
    chemical_id: z.coerce.number().int().positive('Chọn hóa chất'),
    location_id: z.coerce.number().int().positive('Chọn vị trí bảo quản'),
    po_item_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    batch_no: zOptStr, mfg_date: zDateOpt, expiry_date: zDateOpt,
    qty_doc: z.coerce.number().min(0), qty_received: z.coerce.number().min(0),
    result: z.enum(['PASSED', 'QUARANTINE', 'FAILED']).default('PASSED'),
    packaging_ok: z.boolean().default(true), label_ok: z.boolean().default(true),
    condition_note: zOptStr, unit_price: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().min(0)]).optional(), note: zOptStr,
  })).min(1, 'Phải có ít nhất 1 dòng hóa chất'),
});
type Body = z.infer<typeof schema>;

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true } },
  purchase_order: { select: { id: true, code: true } },
  creator: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { chemical: { select: { id: true, code: true, name: true, is_controlled: true, unit: { select: { code: true } }, default_shelf_life_days: true } }, location: { select: { id: true, code: true } } } },
  batches: { select: { id: true, internal_code: true, batch_no: true, receipt_line_id: true, qc_status: true } },
} satisfies Prisma.ChemicalReceiptInclude;

async function validateDraft(d: Body) {
  await chemicalWarehouse(prisma, d.warehouse_id);
  const locs = await prisma.warehouseLocation.findMany({ where: { id: { in: d.lines.map((l) => l.location_id) } } });
  for (const l of d.lines) {
    const loc = locs.find((x) => x.id === l.location_id);
    if (!loc || loc.warehouse_id !== d.warehouse_id) throw badRequest('Vị trí bảo quản không thuộc kho hóa chất đã chọn');
    if (l.mfg_date && l.expiry_date && l.expiry_date < l.mfg_date) throw badRequest('Hạn sử dụng phải sau ngày sản xuất');
    if (l.qty_received <= 0 && l.result !== 'FAILED') throw badRequest('SL thực nhận phải > 0');
  }
  const chems = await prisma.chemical.findMany({ where: { id: { in: d.lines.map((l) => l.chemical_id) } } });
  for (const l of d.lines) {
    const c = chems.find((x) => x.id === l.chemical_id);
    if (!c) throw badRequest('Hóa chất không tồn tại');
    if (c.status !== 'ACTIVE') throw badRequest(`Hóa chất ${c.code} đã bị khóa`);
  }
  await validatePoLink(prisma, d.purchase_order_id, d.supplier_id, 'chemical', d.lines.map((l, i) => ({ po_item_id: l.po_item_id, chemical_id: l.chemical_id, qty: l.result === 'FAILED' ? 0 : l.qty_received, line_no: i + 1 })));
}

/** Kiểm tra chính sách hóa chất trước khi chuyển duyệt / ghi sổ – không cho nhập chính thức khi thiếu thông tin bắt buộc */
async function policyCheck(doc: { chk_packaging: boolean; chk_label: boolean; chk_documents: boolean; chk_sds: boolean; chk_transport: boolean; lines: { line_no: number; chemical_id: number; batch_no: string | null; mfg_date: Date | null; expiry_date: Date | null; result: string; packaging_ok: boolean; label_ok: boolean; condition_note: string | null; qty_doc: Prisma.Decimal; qty_received: Prisma.Decimal; note: string | null; location_id: number }[] }) {
  const s = await getSettings();
  const errors: string[] = [];
  const missingChecks = [['chk_packaging', 'bao bì'], ['chk_label', 'nhãn'], ['chk_documents', 'chứng từ'], ['chk_sds', 'SDS/MSDS'], ['chk_transport', 'điều kiện vận chuyển & tình trạng hàng']].filter(([k]) => !(doc as unknown as Record<string, boolean>)[k]).map(([, l]) => l);
  if (missingChecks.length) errors.push(`Chưa hoàn tất kiểm tra tiếp nhận: ${missingChecks.join(', ')}`);
  const today = todayUTC();
  const { blocks } = await chemicalPolicyBlocks(prisma, doc.lines.filter((l) => l.result !== 'FAILED').map((l) => l.chemical_id));
  for (const l of doc.lines) {
    if (l.result === 'FAILED') { if (!l.condition_note) errors.push(`Dòng ${l.line_no}: hàng không đạt – bắt buộc ghi tình trạng`); continue; }
    if (s['chemical.require_batch'] && !l.batch_no) errors.push(`Dòng ${l.line_no}: thiếu mã lô nhà sản xuất`);
    if (s['chemical.require_expiry'] && !l.expiry_date) errors.push(`Dòng ${l.line_no}: thiếu hạn sử dụng`);
    if (s['chemical.require_mfg_date'] && !l.mfg_date) errors.push(`Dòng ${l.line_no}: thiếu ngày sản xuất`);
    if (l.expiry_date && l.expiry_date < today) errors.push(`Dòng ${l.line_no}: hóa chất đã hết hạn sử dụng – phải đánh dấu "Không đạt yêu cầu" / từ chối tiếp nhận`);
    if (l.result === 'PASSED' && (!l.packaging_ok || !l.label_ok)) errors.push(`Dòng ${l.line_no}: bao bì/nhãn không đạt – không được đánh dấu "Đạt" (chọn Cách ly hoặc Không đạt)`);
    if ((!l.packaging_ok || !l.label_ok || l.result === 'QUARANTINE') && !l.condition_note) errors.push(`Dòng ${l.line_no}: bắt buộc mô tả tình trạng bao bì/nhãn hoặc lý do cách ly`);
    if (!l.qty_doc.equals(l.qty_received) && !l.note && !l.condition_note) errors.push(`Dòng ${l.line_no}: SL thực nhận khác SL chứng từ – bắt buộc ghi lý do`);
    for (const b of blocks.get(l.chemical_id) ?? []) errors.push(`Dòng ${l.line_no}: ${b}`);
  }
  if (errors.length) throw ruleViolation('Chưa đủ điều kiện nhập kho hóa chất theo chính sách công ty:\n• ' + [...new Set(errors)].join('\n• '), { errors });
}

r.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.ChemicalReceiptWhereInput = {};
  if (req.query.q) where.OR = [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { supplier_doc_no: { contains: String(req.query.q), mode: 'insensitive' } }, { supplier: { name: { contains: String(req.query.q), mode: 'insensitive' } } }];
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  if (req.query.from || req.query.to) where.doc_date = { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lte: new Date(String(req.query.to)) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.chemicalReceipt.findMany({ where, skip, take, orderBy: [{ doc_date: 'desc' }, { id: 'desc' }], include: { supplier: { select: { name: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.chemicalReceipt.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('chemicals.view'), async (req, res) => {
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id: Number(req.params.id) }, include });
  if (!doc) throw notFound('Không tìm thấy phiếu nhập hóa chất');
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  const { blocks, sds } = await chemicalPolicyBlocks(prisma, doc.lines.map((l) => l.chemical_id));
  const warnings = doc.status === 'POSTED' ? [] : await incompatibilityWarnings(prisma, doc.lines.filter((l) => l.result !== 'FAILED').map((l) => ({ chemical_id: l.chemical_id, location_id: l.location_id })));
  ok(res, {
    ...doc, history: hist, storage_warnings: warnings,
    lines: doc.lines.map((l) => ({ ...l, sds_state: sds.get(l.chemical_id)?.state, sds_label: SDS_LABEL[sds.get(l.chemical_id)?.state ?? 'MISSING'], policy_blocks: blocks.get(l.chemical_id) ?? [] })),
  });
});

function lineData(d: Body) {
  return d.lines.map((l, i) => ({
    line_no: i + 1, chemical_id: l.chemical_id, location_id: l.location_id, po_item_id: l.po_item_id ?? null, batch_no: l.batch_no,
    mfg_date: l.mfg_date ? toDateOnly(l.mfg_date) : null, expiry_date: l.expiry_date ? toDateOnly(l.expiry_date) : null,
    qty_doc: l.qty_doc, qty_received: l.qty_received, result: l.result, packaging_ok: l.packaging_ok, label_ok: l.label_ok,
    condition_note: l.condition_note, unit_price: l.unit_price ?? null, note: l.note,
  }));
}

r.post('/', requirePerm('chemicals.receipt_create'), async (req, res) => {
  const d = schema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.chemicalReceipt.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  await validateDraft(d);
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.CHEM_RECEIPT, d.doc_date);
    const { lines: _l, ...head } = d;
    const c = await tx.chemicalReceipt.create({ data: { ...head, code, doc_date: toDateOnly(d.doc_date), received_date: toDateOnly(d.received_date), created_by: req.user!.id, updated_by: req.user!.id, lines: { create: lineData(d) } } });
    await history(tx, ENTITY, c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

r.put('/:id', requirePerm('chemicals.receipt_create'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.chemicalReceipt.findUnique({ where: { id } });
  if (!before) throw notFound();
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa phiếu');
  const d = schema.parse(req.body);
  await validateDraft(d);
  await withTx(async (tx) => {
    await transition(tx, 'chemicalReceipt', id, ['DRAFT'], { updated_by: req.user!.id });
    await tx.chemicalReceiptItem.deleteMany({ where: { receipt_id: id } });
    const { lines: _l, client_request_id: _c, ...head } = d;
    await tx.chemicalReceipt.update({ where: { id }, data: { ...head, doc_date: toDateOnly(d.doc_date), received_date: toDateOnly(d.received_date), lines: { create: lineData(d) } } });
    await audit(req, 'UPDATE', ENTITY, before, before, d, tx);
  });
  ok(res, { id });
});

r.post('/:id/submit', requirePerm('chemicals.receipt_create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  if (doc.lines.every((l) => l.result === 'FAILED')) throw ruleViolation('Toàn bộ hàng không đạt – hãy dùng "Từ chối tiếp nhận"');
  await policyCheck(doc);
  await assertPeriodOpen(prisma, doc.doc_date);
  await withTx(async (tx) => {
    await transition(tx, 'chemicalReceipt', id, ['DRAFT'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, 'DRAFT', 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, undefined, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['chemicals.receipt_approve'], req.user!.id, { type: 'APPROVAL', title: `Phiếu nhập hóa chất ${doc.code} chờ phê duyệt`, link: `/chem-receipts/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

r.post('/:id/approve', requirePerm('chemicals.receipt_approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by]);
  await policyCheck(doc); // kiểm tra lại tại thời điểm duyệt (SDS có thể hết hạn trong lúc chờ)
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'chemicalReceipt', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: now, posted_at: now });
    const moves = [];
    for (const l of doc.lines.filter((x) => x.result !== 'FAILED' && x.qty_received.gt(0))) {
      const internal = `${doc.code}-${String(l.line_no).padStart(2, '0')}`;
      const b = await tx.chemicalBatch.create({
        data: {
          chemical_id: l.chemical_id, warehouse_id: doc.warehouse_id, location_id: l.location_id, batch_no: l.batch_no ?? internal, internal_code: internal,
          mfg_date: l.mfg_date, received_date: doc.received_date, expiry_date: l.expiry_date, qty_received: l.qty_received, qty_on_hand: 0,
          supplier_id: doc.supplier_id, qc_status: l.result === 'PASSED' ? 'PASSED' : 'QUARANTINE', qc_note: l.condition_note,
          abnormal: !l.packaging_ok || !l.label_ok, abnormal_note: !l.packaging_ok || !l.label_ok ? l.condition_note : null,
          receipt_id: doc.id, receipt_line_id: l.id, created_by: req.user!.id,
        },
      });
      moves.push({ batch_id: b.id, direction: 'IN' as const, qty: l.qty_received, movement_type: 'RECEIPT' as const, doc_type: 'CHEM_RECEIPT', doc_id: doc.id, doc_code: doc.code, doc_date: doc.doc_date, note: l.result === 'QUARANTINE' ? 'Nhập kho cách ly' : null });
    }
    await postChemMovements(tx, req.user!.id, moves);
    await applyPoReceipt(tx, doc.purchase_order_id, doc.lines.filter((l) => l.result !== 'FAILED').map((l) => ({ po_item_id: l.po_item_id, qty: l.qty_received })));
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', ENTITY, doc, undefined, { status: 'POSTED', batches: moves.length }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'INFO', title: `Phiếu nhập hóa chất ${doc.code} đã nhập kho (${moves.length} lô)`, link: `/chem-receipts/${id}` });
  });
  ok(res, { id, status: 'POSTED' });
});

/** Người duyệt trả về để kiểm tra / bổ sung */
r.post('/:id/return', requirePerm('chemicals.receipt_approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by], 'trả về');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalReceipt', id, ['SUBMITTED'], { status: 'DRAFT', reject_reason: reason });
    await history(tx, ENTITY, id, 'RETURN', req.user!.id, 'SUBMITTED', 'DRAFT', reason);
    await audit(req, 'RETURN', ENTITY, doc, undefined, { reason }, tx);
    await notifyUsers(tx, [doc.created_by], { type: 'WARNING', title: `Phiếu nhập hóa chất ${doc.code} bị trả về`, message: reason, link: `/chem-receipts/${id}` });
  });
  ok(res, { id, status: 'DRAFT' });
});

/** Từ chối tiếp nhận toàn bộ lô hàng (trả lại nhà cung cấp) */
r.post('/:id/refuse', requirePerm('chemicals.receipt_create', 'chemicals.receipt_approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Nhập lý do từ chối tiếp nhận') }).parse(req.body);
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'chemicalReceipt', id, ['DRAFT', 'SUBMITTED'], { status: 'REJECTED', reject_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'REFUSE', req.user!.id, doc.status, 'REJECTED', reason);
    await audit(req, 'REFUSE', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'REJECTED' });
});

r.post('/:id/cancel', requirePerm('chemicals.receipt_create'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.chemicalReceipt.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'chemicalReceipt', id, ['DRAFT'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, 'DRAFT', 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
