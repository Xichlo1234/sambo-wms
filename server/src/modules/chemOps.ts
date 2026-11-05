/**
 * KHO HÓA CHẤT – Kiểm kê theo lô (6.7), Điều chỉnh / Tiêu hủy lô, Nhật ký kiểm tra kho & Nhật ký sự cố (6.6)
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx, type Tx } from '../db';
import { requirePerm, assertNotSelf } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission } from '../lib/notify';
import { toDateOnly } from '../services/inventory';
import { chemicalWarehouse, postChemMovements, batchBlockReasons, todayUTC } from '../services/chemicals';

export const chemStocktakesRouter = Router();
export const chemAdjustmentsRouter = Router();
export const chemInspectionsRouter = Router();
export const chemIncidentsRouter = Router();
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const users = async (ids: (number | null | undefined)[]) => prisma.user.findMany({ where: { id: { in: ids.filter(Boolean) as number[] } }, select: { id: true, full_name: true } });

// ======================= ĐIỀU CHỈNH / TIÊU HỦY =======================
async function createAdj(tx: Tx, uid: number, d: { warehouse_id: number; adj_type: string; doc_date: Date; reason: string; disposal_method?: string | null; stocktake_id?: number; status?: 'DRAFT' | 'SUBMITTED' }, lines: { batch_id: number; qty_delta: number; reason?: string | null }[]) {
  const code = await nextDocNo(tx, DOC_PREFIX.CHEM_ADJUST, d.doc_date);
  const c = await tx.chemicalAdjustment.create({
    data: { code, warehouse_id: d.warehouse_id, adj_type: d.adj_type, doc_date: toDateOnly(d.doc_date), reason: d.reason, disposal_method: d.disposal_method ?? null, stocktake_id: d.stocktake_id ?? null, status: d.status ?? 'DRAFT', submitted_at: d.status === 'SUBMITTED' ? new Date() : null, created_by: uid, lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } },
  });
  await history(tx, 'chemical_adjustment', c.id, 'CREATE', uid, null, c.status);
  return c;
}

const adjInclude = { lines: { orderBy: { line_no: 'asc' as const } } };
async function enrichAdj(a: Prisma.ChemicalAdjustmentGetPayload<{ include: typeof adjInclude }>) {
  const batches = await prisma.chemicalBatch.findMany({ where: { id: { in: a.lines.map((l) => l.batch_id) } }, include: { chemical: { select: { code: true, name: true, unit: { select: { code: true } } } }, location: { select: { code: true } } } });
  const u = await users([a.created_by, a.approved_by]);
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: 'chemical_adjustment', entity_id: a.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  return { ...a, creator: u.find((x) => x.id === a.created_by), approver: u.find((x) => x.id === a.approved_by), history: hist, lines: a.lines.map((l) => ({ ...l, batch: batches.find((b) => b.id === l.batch_id) })) };
}

chemAdjustmentsRouter.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.ChemicalAdjustmentWhereInput = {};
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  if (req.query.q) where.OR = [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { reason: { contains: String(req.query.q), mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([prisma.chemicalAdjustment.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { _count: { select: { lines: true } } } }), prisma.chemicalAdjustment.count({ where })]);
  const u = await users(rows.map((r) => r.created_by));
  ok(res, rows.map((r) => ({ ...r, creator: u.find((x) => x.id === r.created_by) })), pageMeta(page, pageSize, total));
});

chemAdjustmentsRouter.get('/:id', requirePerm('chemicals.view'), async (req, res) => {
  const a = await prisma.chemicalAdjustment.findUnique({ where: { id: Number(req.params.id) }, include: adjInclude });
  if (!a) throw notFound();
  ok(res, await enrichAdj(a));
});

chemAdjustmentsRouter.post('/', requirePerm('chemicals.adjust'), async (req, res) => {
  const d = z.object({
    warehouse_id: z.coerce.number().int().positive(), adj_type: z.enum(['ADJUSTMENT', 'DISPOSAL']), doc_date: z.coerce.date(),
    reason: z.string().trim().min(5, 'Bắt buộc nhập lý do (tối thiểu 5 ký tự)'), disposal_method: zOptStr,
    lines: z.array(z.object({ batch_id: z.coerce.number().int().positive(), qty_delta: z.coerce.number().refine((v) => v !== 0, 'SL phải khác 0'), reason: zOptStr })).min(1),
  }).parse(req.body);
  await chemicalWarehouse(prisma, d.warehouse_id);
  if (d.adj_type === 'DISPOSAL') {
    if (!d.disposal_method) throw badRequest('Tiêu hủy: bắt buộc ghi phương thức / đơn vị xử lý (theo SDS và quy định)');
    if (d.lines.some((l) => l.qty_delta > 0)) throw badRequest('Tiêu hủy chỉ nhập số lượng âm');
  }
  const bs = await prisma.chemicalBatch.findMany({ where: { id: { in: d.lines.map((l) => l.batch_id) } } });
  if (bs.length !== new Set(d.lines.map((l) => l.batch_id)).size || bs.some((b) => b.warehouse_id !== d.warehouse_id)) throw badRequest('Lô không thuộc kho đã chọn');
  const a = await withTx(async (tx) => {
    const c = await createAdj(tx, req.user!.id, d, d.lines);
    await audit(req, 'CREATE', 'chemical_adjustment', c, undefined, d, tx);
    return c;
  });
  ok(res, a);
});

chemAdjustmentsRouter.post('/:id/submit', requirePerm('chemicals.adjust'), async (req, res) => {
  const id = Number(req.params.id);
  const a = await prisma.chemicalAdjustment.findUnique({ where: { id } });
  if (!a) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'chemicalAdjustment', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, 'chemical_adjustment', id, 'SUBMIT', req.user!.id, a.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', 'chemical_adjustment', a, undefined, undefined, tx);
    await notifyPermission(tx, ['chemicals.approve_adjust'], req.user!.id, { type: 'APPROVAL', title: `${a.adj_type === 'DISPOSAL' ? 'Phiếu tiêu hủy' : 'Phiếu điều chỉnh'} hóa chất ${a.code} chờ duyệt`, link: `/chem-adjustments/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

async function approveAdj(reqUser: { id: number }, req: Parameters<typeof audit>[0], id: number, comment?: string | null) {
  const a = await prisma.chemicalAdjustment.findUnique({ where: { id }, include: { lines: true } });
  if (!a) throw notFound();
  assertNotSelf(req!, [a.created_by]);
  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'chemicalAdjustment', id, ['SUBMITTED'], { status: 'POSTED', approved_by: reqUser.id, approved_at: now, posted_at: now });
    await postChemMovements(tx, reqUser.id, a.lines.map((l) => ({
      batch_id: l.batch_id, direction: l.qty_delta.gt(0) ? 'IN' as const : 'OUT' as const, qty: l.qty_delta.abs(),
      movement_type: a.adj_type === 'DISPOSAL' ? 'DISPOSAL' as const : a.adj_type === 'STOCKTAKE' ? 'STOCKTAKE' as const : 'ADJUSTMENT' as const,
      doc_type: 'CHEM_ADJUST', doc_id: a.id, doc_code: a.code, doc_date: a.doc_date, note: l.reason || a.reason,
    })));
    if (a.stocktake_id) {
      await transition(tx, 'chemicalStocktake', a.stocktake_id, ['SUBMITTED'], { status: 'POSTED', approved_by: reqUser.id, approved_at: now });
      await history(tx, 'chemical_stocktake', a.stocktake_id, 'APPROVE', reqUser.id, 'SUBMITTED', 'POSTED', comment);
    }
    await history(tx, 'chemical_adjustment', id, 'APPROVE', reqUser.id, 'SUBMITTED', 'POSTED', comment);
    await audit(req, 'APPROVE_POST', 'chemical_adjustment', a, undefined, undefined, tx);
  });
}

chemAdjustmentsRouter.post('/:id/approve', requirePerm('chemicals.approve_adjust'), async (req, res) => {
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  await approveAdj(req.user!, req, Number(req.params.id), comment);
  ok(res, { status: 'POSTED' });
});

chemAdjustmentsRouter.post('/:id/reject', requirePerm('chemicals.approve_adjust'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
  const a = await prisma.chemicalAdjustment.findUnique({ where: { id } });
  if (!a) throw notFound();
  if (a.stocktake_id) throw ruleViolation('Phiếu điều chỉnh từ kiểm kê – xử lý tại màn hình Kiểm kê hóa chất');
  assertNotSelf(req, [a.created_by], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalAdjustment', id, ['SUBMITTED'], { status: 'REJECTED', reject_reason: reason });
    await history(tx, 'chemical_adjustment', id, 'REJECT', req.user!.id, 'SUBMITTED', 'REJECTED', reason);
    await audit(req, 'REJECT', 'chemical_adjustment', a, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'REJECTED' });
});

chemAdjustmentsRouter.post('/:id/cancel', requirePerm('chemicals.adjust'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
  const a = await prisma.chemicalAdjustment.findUnique({ where: { id } });
  if (!a) throw notFound();
  if (a.stocktake_id) throw ruleViolation('Phiếu điều chỉnh từ kiểm kê – xử lý tại màn hình Kiểm kê hóa chất');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalAdjustment', id, ['DRAFT', 'SUBMITTED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason });
    await history(tx, 'chemical_adjustment', id, 'CANCEL', req.user!.id, a.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', 'chemical_adjustment', a, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

// ======================= KIỂM KÊ HÓA CHẤT THEO LÔ =======================
chemStocktakesRouter.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.ChemicalStocktakeWhereInput = req.query.status ? { status: String(req.query.status) as 'DRAFT' } : {};
  const [rows, total] = await Promise.all([prisma.chemicalStocktake.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { _count: { select: { lines: true } } } }), prisma.chemicalStocktake.count({ where })]);
  const u = await users(rows.map((r) => r.created_by));
  ok(res, rows.map((r) => ({ ...r, creator: u.find((x) => x.id === r.created_by) })), pageMeta(page, pageSize, total));
});

chemStocktakesRouter.get('/:id', requirePerm('chemicals.view'), async (req, res) => {
  const id = Number(req.params.id);
  const st = await prisma.chemicalStocktake.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
  if (!st) throw notFound();
  const batches = await prisma.chemicalBatch.findMany({ where: { id: { in: st.lines.map((l) => l.batch_id) } }, include: { chemical: { select: { code: true, name: true, unit: { select: { code: true } } } }, location: { select: { code: true } } } });
  const adj = await prisma.chemicalAdjustment.findUnique({ where: { stocktake_id: id }, select: { id: true, code: true, status: true } });
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: 'chemical_stocktake', entity_id: id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  const today = todayUTC();
  const wh = await prisma.warehouse.findUnique({ where: { id: st.warehouse_id }, select: { code: true, name: true } });
  ok(res, {
    ...st, warehouse: wh, adjustment: adj, history: hist,
    lines: st.lines.map((l) => {
      const b = batches.find((x) => x.id === l.batch_id)!;
      return { ...l, batch: b, expired: !!b.expiry_date && b.expiry_date < today, variance: l.counted_qty != null ? Number(l.counted_qty.minus(l.book_qty)) : null };
    }).sort((a, b) => (a.batch.location.code + a.batch.chemical.code).localeCompare(b.batch.location.code + b.batch.chemical.code)),
  });
});

chemStocktakesRouter.post('/', requirePerm('chemicals.stocktake'), async (req, res) => {
  const d = z.object({ warehouse_id: z.coerce.number().int().positive(), name: z.string().trim().min(3, 'Nhập tên đợt kiểm kê'), chemical_ids: z.array(z.number()).default([]), location_ids: z.array(z.number()).default([]), note: zOptStr }).parse(req.body);
  await chemicalWarehouse(prisma, d.warehouse_id);
  const st = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.CHEM_STOCKTAKE);
    const c = await tx.chemicalStocktake.create({ data: { code, warehouse_id: d.warehouse_id, name: d.name, note: [d.note, d.chemical_ids.length ? `chem:${d.chemical_ids.join(',')}` : '', d.location_ids.length ? `loc:${d.location_ids.join(',')}` : ''].filter(Boolean).join(' | ') || null, created_by: req.user!.id } });
    // Chốt tồn sổ ngay khi tạo – theo từng lô
    const bs = await tx.chemicalBatch.findMany({ where: { warehouse_id: d.warehouse_id, qty_on_hand: { gt: 0 }, ...(d.chemical_ids.length ? { chemical_id: { in: d.chemical_ids } } : {}), ...(d.location_ids.length ? { location_id: { in: d.location_ids } } : {}) } });
    if (!bs.length) throw ruleViolation('Không có lô hóa chất còn tồn trong phạm vi kiểm kê');
    await tx.chemicalStocktakeItem.createMany({ data: bs.map((b) => ({ stocktake_id: c.id, batch_id: b.id, book_qty: b.qty_on_hand })) });
    await tx.chemicalStocktake.update({ where: { id: c.id }, data: { status: 'COUNTING', snapshot_at: new Date() } });
    await history(tx, 'chemical_stocktake', c.id, 'FREEZE', req.user!.id, null, 'COUNTING', `Chốt ${bs.length} lô`);
    await audit(req, 'CREATE', 'chemical_stocktake', c, undefined, d, tx);
    return c;
  });
  ok(res, st);
});

chemStocktakesRouter.put('/:id/counts', requirePerm('chemicals.stocktake'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ lines: z.array(z.object({ id: z.number(), counted_qty: z.union([z.coerce.number().min(0), z.literal('').transform(() => null), z.null()]), packaging_ok: z.boolean().nullable().optional(), packaging_note: zOptStr, reason: zOptStr })) }).parse(req.body);
  const st = await prisma.chemicalStocktake.findUnique({ where: { id } });
  if (!st) throw notFound();
  if (st.status !== 'COUNTING') throw ruleViolation('Đợt kiểm kê không ở trạng thái kiểm đếm');
  await withTx(async (tx) => {
    for (const l of d.lines) await tx.chemicalStocktakeItem.updateMany({ where: { id: l.id, stocktake_id: id }, data: { counted_qty: l.counted_qty, packaging_ok: l.packaging_ok ?? null, packaging_note: l.packaging_note, reason: l.reason, counted_by: req.user!.id, counted_at: new Date() } });
  });
  ok(res, { saved: d.lines.length });
});

chemStocktakesRouter.post('/:id/submit', requirePerm('chemicals.stocktake'), async (req, res) => {
  const id = Number(req.params.id);
  const st = await prisma.chemicalStocktake.findUnique({ where: { id }, include: { lines: true } });
  if (!st) throw notFound();
  const missing = st.lines.filter((l) => l.counted_qty == null || l.packaging_ok == null);
  if (missing.length) throw ruleViolation(`Còn ${missing.length} lô chưa nhập số thực tế hoặc tình trạng bao bì`);
  const diff = st.lines.filter((l) => !l.counted_qty!.equals(l.book_qty));
  if (diff.some((l) => !l.reason)) throw ruleViolation('Bắt buộc giải trình nguyên nhân cho mọi lô có chênh lệch');
  if (st.lines.some((l) => l.packaging_ok === false && !l.packaging_note)) throw ruleViolation('Lô có bao bì bất thường – bắt buộc mô tả tình trạng');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalStocktake', id, ['COUNTING'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    if (diff.length) await createAdj(tx, req.user!.id, { warehouse_id: st.warehouse_id, adj_type: 'STOCKTAKE', doc_date: new Date(), reason: `Điều chỉnh theo kiểm kê hóa chất ${st.code} – ${st.name}`, stocktake_id: id, status: 'SUBMITTED' }, diff.map((l) => ({ batch_id: l.batch_id, qty_delta: Number(l.counted_qty!.minus(l.book_qty)), reason: l.reason })));
    await history(tx, 'chemical_stocktake', id, 'SUBMIT', req.user!.id, 'COUNTING', 'SUBMITTED', `${diff.length} lô chênh lệch`);
    await audit(req, 'SUBMIT', 'chemical_stocktake', st, undefined, { variance: diff.length }, tx);
    await notifyPermission(tx, ['chemicals.approve_adjust'], req.user!.id, { type: 'APPROVAL', title: `Kiểm kê hóa chất ${st.code} chờ duyệt`, link: `/chem-stocktakes/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED', variance_lines: diff.length });
});

chemStocktakesRouter.post('/:id/approve', requirePerm('chemicals.approve_adjust'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const st = await prisma.chemicalStocktake.findUnique({ where: { id }, include: { lines: true } });
  if (!st) throw notFound();
  assertNotSelf(req, [st.created_by]);
  const adj = await prisma.chemicalAdjustment.findUnique({ where: { stocktake_id: id } });
  if (adj && adj.status === 'SUBMITTED') await approveAdj(req.user!, req, adj.id, comment);
  else await withTx(async (tx) => {
    await transition(tx, 'chemicalStocktake', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: new Date() });
    await history(tx, 'chemical_stocktake', id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment ?? 'Không chênh lệch');
  });
  // Đánh dấu lô có bao bì bất thường phát hiện khi kiểm kê
  for (const l of st.lines.filter((x) => x.packaging_ok === false)) {
    await prisma.chemicalBatch.update({ where: { id: l.batch_id }, data: { abnormal: true, abnormal_note: `Kiểm kê ${st.code}: ${l.packaging_note}` } });
  }
  await audit(req, 'APPROVE', 'chemical_stocktake', st);
  ok(res, { id, status: 'POSTED' });
});

chemStocktakesRouter.post('/:id/reject', requirePerm('chemicals.approve_adjust'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
  const st = await prisma.chemicalStocktake.findUnique({ where: { id } });
  if (!st) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'chemicalStocktake', id, ['SUBMITTED'], { status: 'COUNTING', reject_reason: reason });
    const adj = await tx.chemicalAdjustment.findUnique({ where: { stocktake_id: id } });
    if (adj) await tx.chemicalAdjustment.update({ where: { id: adj.id }, data: { stocktake_id: null, status: 'CANCELLED', cancel_reason: 'Trả về kiểm kê: ' + reason } });
    await history(tx, 'chemical_stocktake', id, 'REJECT', req.user!.id, 'SUBMITTED', 'COUNTING', reason);
    await audit(req, 'REJECT', 'chemical_stocktake', st, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'COUNTING' });
});

chemStocktakesRouter.post('/:id/cancel', requirePerm('chemicals.stocktake'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3) }).parse(req.body);
  const st = await prisma.chemicalStocktake.findUnique({ where: { id } });
  if (!st) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'chemicalStocktake', id, ['DRAFT', 'COUNTING'], { status: 'CANCELLED', reject_reason: reason });
    await history(tx, 'chemical_stocktake', id, 'CANCEL', req.user!.id, st.status, 'CANCELLED', reason);
  });
  ok(res, { id, status: 'CANCELLED' });
});

// ======================= NHẬT KÝ KIỂM TRA KHO HÓA CHẤT =======================
chemInspectionsRouter.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const [rows, total] = await Promise.all([prisma.chemicalInspection.findMany({ skip, take, orderBy: { inspected_at: 'desc' } }), prisma.chemicalInspection.count()]);
  const u = await users(rows.map((r) => r.inspector_id));
  ok(res, rows.map((r) => ({ ...r, inspector: u.find((x) => x.id === r.inspector_id)?.full_name })), pageMeta(page, pageSize, total));
});
chemInspectionsRouter.post('/', requirePerm('chemicals.inspection'), async (req, res) => {
  const d = z.object({
    warehouse_id: z.coerce.number().int().positive(), inspected_at: z.coerce.date(),
    temperature: z.union([z.coerce.number(), z.literal('').transform(() => null), z.null()]).optional(), humidity: z.union([z.coerce.number().min(0).max(100), z.literal('').transform(() => null), z.null()]).optional(),
    ventilation_ok: z.boolean(), fire_equipment_ok: z.boolean(), spill_kit_ok: z.boolean(), labeling_ok: z.boolean(), segregation_ok: z.boolean(), ppe_ok: z.boolean(),
    findings: zOptStr, actions: zOptStr,
  }).parse(req.body);
  await chemicalWarehouse(prisma, d.warehouse_id);
  const allOk = d.ventilation_ok && d.fire_equipment_ok && d.spill_kit_ok && d.labeling_ok && d.segregation_ok && d.ppe_ok;
  if (!allOk && (!d.findings || !d.actions)) throw badRequest('Có hạng mục không đạt – bắt buộc ghi phát hiện và biện pháp khắc phục');
  const row = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.CHEM_INSPECTION);
    const c = await tx.chemicalInspection.create({ data: { ...d, code, inspector_id: req.user!.id, result: allOk ? 'PASS' : 'ISSUES' } });
    if (!allOk) await notifyPermission(tx, ['chemicals.safety_verify', 'chemicals.approve_adjust'], req.user!.id, { type: 'WARNING', title: `Kiểm tra kho hóa chất ${code}: có hạng mục không đạt`, message: d.findings ?? '', link: '/chem-safety?tab=inspections' });
    await audit(req, 'CREATE', 'chemical_inspection', c, undefined, d, tx);
    return c;
  });
  ok(res, row);
});

// ======================= NHẬT KÝ SỰ CỐ =======================
chemIncidentsRouter.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where = req.query.status ? { status: String(req.query.status) } : {};
  const [rows, total] = await Promise.all([prisma.chemicalIncident.findMany({ where, skip, take, orderBy: { occurred_at: 'desc' } }), prisma.chemicalIncident.count({ where })]);
  const u = await users(rows.flatMap((r) => [r.reported_by, r.handled_by]));
  const chems = await prisma.chemical.findMany({ where: { id: { in: rows.map((r) => r.chemical_id).filter(Boolean) as number[] } }, select: { id: true, code: true, name: true } });
  ok(res, rows.map((r) => ({ ...r, reporter: u.find((x) => x.id === r.reported_by)?.full_name, handler: u.find((x) => x.id === r.handled_by)?.full_name, chemical: chems.find((c) => c.id === r.chemical_id) })), pageMeta(page, pageSize, total));
});
chemIncidentsRouter.post('/', requirePerm('chemicals.incident'), async (req, res) => {
  const d = z.object({
    occurred_at: z.coerce.date(), warehouse_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(), location_text: zOptStr,
    chemical_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(), batch_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    incident_type: z.enum(['SPILL', 'LEAK', 'FIRE', 'EXPOSURE', 'PACKAGING', 'OTHER']), severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    description: z.string().trim().min(5, 'Mô tả sự cố'), actions_taken: zOptStr, injuries: zOptStr,
  }).parse(req.body);
  const row = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.CHEM_INCIDENT);
    const c = await tx.chemicalIncident.create({ data: { ...d, code, reported_by: req.user!.id } });
    if (d.batch_id && d.incident_type === 'PACKAGING') await tx.chemicalBatch.update({ where: { id: d.batch_id }, data: { abnormal: true, abnormal_note: `Sự cố ${code}: ${d.description}` } });
    await notifyPermission(tx, ['chemicals.safety_verify', 'chemicals.hse_confirm'], req.user!.id, { type: 'WARNING', title: `Sự cố hóa chất ${code} (${d.severity})`, message: d.description, link: '/chem-safety?tab=incidents' });
    await audit(req, 'CREATE', 'chemical_incident', c, undefined, d, tx);
    return c;
  });
  ok(res, row);
});
chemIncidentsRouter.post('/:id/close', requirePerm('chemicals.incident'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ actions_taken: z.string().trim().min(5, 'Ghi biện pháp xử lý đã thực hiện'), close_note: zOptStr }).parse(req.body);
  const inc = await prisma.chemicalIncident.findUnique({ where: { id } });
  if (!inc) throw notFound();
  if (inc.status === 'CLOSED') throw ruleViolation('Sự cố đã đóng');
  const u = await prisma.chemicalIncident.update({ where: { id }, data: { status: 'CLOSED', actions_taken: d.actions_taken, close_note: d.close_note, handled_by: req.user!.id, closed_at: new Date() } });
  await audit(req, 'CLOSE', 'chemical_incident', inc, undefined, d);
  ok(res, u);
});

export { batchBlockReasons, D };
