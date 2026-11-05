/**
 * KIỂM KÊ (5.1.5)
 * DRAFT → (chốt tồn sổ) COUNTING → (gửi duyệt: tạo phiếu điều chỉnh chênh lệch) SUBMITTED → (duyệt) POSTED
 * Chênh lệch = Thực tế – Sổ sách. Nhập số kiểm kê KHÔNG tự điều chỉnh tồn – chỉ ghi sổ khi được phê duyệt.
 */
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission } from '../lib/notify';
import { toDateOnly } from '../services/inventory';
import { createAdjustment, approveAdjustment } from './adjustments';

const r = Router();
const ENTITY = 'stocktake';

const createSchema = z.object({
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  name: z.string().trim().min(3, 'Nhập tên đợt kiểm kê'),
  scope_type: z.enum(['ALL', 'CATEGORY', 'LOCATION', 'ITEMS']),
  category_ids: z.array(z.coerce.number().int()).default([]),
  location_ids: z.array(z.coerce.number().int()).default([]),
  item_ids: z.array(z.coerce.number().int()).default([]),
  note: zOptStr,
});

r.get('/', requirePerm('stocktakes.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where: Prisma.StocktakeWhereInput = {};
  if (req.query.status) where.status = String(req.query.status) as 'DRAFT';
  if (req.query.q) where.OR = [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { name: { contains: String(req.query.q), mode: 'insensitive' } }];
  const [rows, total] = await Promise.all([
    prisma.stocktake.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { warehouse: { select: { code: true } }, creator: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.stocktake.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('stocktakes.view'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stocktake.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      creator: { select: { full_name: true } },
      adjustment: { select: { id: true, code: true, status: true } },
      lines: {
        orderBy: [{ location_id: 'asc' }, { item_id: 'asc' }],
        include: { item: { select: { id: true, code: true, name: true, specification: true, unit: { select: { code: true } } } }, location: { select: { id: true, code: true } } },
      },
    },
  });
  if (!doc) throw notFound();
  let movedAfterSnapshot = 0;
  if (doc.snapshot_at && ['COUNTING', 'SUBMITTED'].includes(doc.status) && doc.lines.length) {
    movedAfterSnapshot = await prisma.stockMovement.count({
      where: { warehouse_id: doc.warehouse_id, posted_at: { gt: doc.snapshot_at }, item_id: { in: doc.lines.map((l) => l.item_id) } },
    });
  }
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, {
    ...doc,
    moved_after_snapshot: movedAfterSnapshot,
    lines: doc.lines.map((l) => ({ ...l, variance: l.counted_qty != null ? Number(l.counted_qty.minus(l.book_qty)) : null })),
    history: hist,
  });
});

r.post('/', requirePerm('stocktakes.create'), async (req, res) => {
  const d = createSchema.parse(req.body);
  if (d.scope_type === 'CATEGORY' && !d.category_ids.length) throw badRequest('Chọn ít nhất 1 nhóm vật tư');
  if (d.scope_type === 'LOCATION' && !d.location_ids.length) throw badRequest('Chọn ít nhất 1 vị trí');
  if (d.scope_type === 'ITEMS' && !d.item_ids.length) throw badRequest('Chọn ít nhất 1 mặt hàng');
  const wh = await prisma.warehouse.findUnique({ where: { id: d.warehouse_id } });
  if (!wh || wh.type !== 'GENERAL') throw badRequest('Kho không hợp lệ');
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.STOCKTAKE);
    const c = await tx.stocktake.create({
      data: {
        code, warehouse_id: d.warehouse_id, name: d.name, scope_type: d.scope_type, note: d.note,
        scope_ref: { category_ids: d.category_ids, location_ids: d.location_ids, item_ids: d.item_ids },
        created_by: req.user!.id, updated_by: req.user!.id,
      },
    });
    await history(tx, ENTITY, c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

/** Chốt tồn sổ tại thời điểm kiểm kê */
r.post('/:id/freeze', requirePerm('stocktakes.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stocktake.findUnique({ where: { id } });
  if (!doc) throw notFound();
  const ref = (doc.scope_ref ?? {}) as { category_ids?: number[]; location_ids?: number[]; item_ids?: number[] };
  await withTx(async (tx) => {
    await transition(tx, 'stocktake', id, ['DRAFT'], { status: 'COUNTING', snapshot_at: new Date() });
    const where: Prisma.InventoryBalanceWhereInput = { warehouse_id: doc.warehouse_id, qty_usable: { gt: 0 } };
    if (doc.scope_type === 'CATEGORY') where.item = { OR: [{ category_id: { in: ref.category_ids } }, { subcategory_id: { in: ref.category_ids } }] };
    if (doc.scope_type === 'LOCATION') where.location_id = { in: ref.location_ids };
    if (doc.scope_type === 'ITEMS') where.item_id = { in: ref.item_ids };
    const bal = await tx.inventoryBalance.findMany({ where, select: { item_id: true, location_id: true, qty_usable: true } });
    const rows = bal.map((b) => ({ stocktake_id: id, item_id: b.item_id, location_id: b.location_id, book_qty: b.qty_usable }));
    if (doc.scope_type === 'ITEMS') {
      // Mặt hàng được chọn nhưng chưa có tồn: thêm dòng tồn sổ = 0 tại vị trí mặc định để vẫn kiểm đếm
      const have = new Set(rows.map((x) => x.item_id));
      const missing = await tx.item.findMany({ where: { id: { in: (ref.item_ids ?? []).filter((i) => !have.has(i)) } } });
      const firstLoc = await tx.warehouseLocation.findFirst({ where: { warehouse_id: doc.warehouse_id, status: 'ACTIVE' }, orderBy: { code: 'asc' } });
      for (const it of missing) {
        const loc = it.default_location_id ?? firstLoc?.id;
        if (loc) rows.push({ stocktake_id: id, item_id: it.id, location_id: loc, book_qty: new Prisma.Decimal(0) });
      }
    }
    if (!rows.length) throw ruleViolation('Không có mặt hàng nào trong phạm vi kiểm kê có tồn sổ. Kiểm tra lại phạm vi.');
    await tx.stocktakeItem.createMany({ data: rows });
    await history(tx, ENTITY, id, 'FREEZE', req.user!.id, 'DRAFT', 'COUNTING', `Chốt ${rows.length} dòng tồn sổ`);
    await audit(req, 'FREEZE', ENTITY, doc, undefined, { lines: rows.length }, tx);
  });
  ok(res, { id, status: 'COUNTING' });
});

/** Thêm dòng phát hiện thực tế mà sổ không có (tồn sổ = 0) */
r.post('/:id/lines', requirePerm('stocktakes.count'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ item_id: z.coerce.number().int().positive(), location_id: z.coerce.number().int().positive() }).parse(req.body);
  const doc = await prisma.stocktake.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (doc.status !== 'COUNTING') throw ruleViolation('Chỉ thêm dòng khi đang kiểm đếm');
  const loc = await prisma.warehouseLocation.findUnique({ where: { id: d.location_id } });
  if (loc?.warehouse_id !== doc.warehouse_id) throw badRequest('Vị trí không thuộc kho kiểm kê');
  const bal = await prisma.inventoryBalance.findUnique({ where: { warehouse_id_location_id_item_id: { warehouse_id: doc.warehouse_id, location_id: d.location_id, item_id: d.item_id } } });
  const line = await prisma.stocktakeItem.create({ data: { stocktake_id: id, ...d, book_qty: bal?.qty_usable ?? 0 } });
  await audit(req, 'ADD_LINE', ENTITY, doc, undefined, d);
  ok(res, line);
});

/** Nhập số lượng thực tế & giải trình – lưu từng phần được */
r.put('/:id/counts', requirePerm('stocktakes.count'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    lines: z.array(z.object({
      id: z.coerce.number().int(),
      counted_qty: z.union([z.coerce.number().min(0, 'SL thực tế không âm'), z.literal('').transform(() => null), z.null()]),
      reason: zOptStr,
    })),
  }).parse(req.body);
  const doc = await prisma.stocktake.findUnique({ where: { id } });
  if (!doc) throw notFound();
  if (doc.status !== 'COUNTING') throw ruleViolation('Đợt kiểm kê không ở trạng thái kiểm đếm');
  await withTx(async (tx) => {
    for (const l of d.lines) {
      await tx.stocktakeItem.updateMany({
        where: { id: l.id, stocktake_id: id },
        data: { counted_qty: l.counted_qty, reason: l.reason, counted_by: req.user!.id, counted_at: new Date() },
      });
    }
  });
  await audit(req, 'COUNT', ENTITY, doc, undefined, { lines: d.lines.length });
  ok(res, { saved: d.lines.length });
});

/** Gửi duyệt: lập biên bản + phiếu điều chỉnh chênh lệch (chưa ghi sổ) */
r.post('/:id/submit', requirePerm('stocktakes.count', 'stocktakes.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await prisma.stocktake.findUnique({ where: { id }, include: { lines: { include: { item: { select: { code: true } } } } } });
  if (!doc) throw notFound();
  const notCounted = doc.lines.filter((l) => l.counted_qty == null);
  if (notCounted.length) throw ruleViolation(`Còn ${notCounted.length} dòng chưa nhập số thực tế (vd: ${notCounted.slice(0, 5).map((l) => l.item.code).join(', ')})`);
  const diff = doc.lines.filter((l) => !l.counted_qty!.equals(l.book_qty));
  const noReason = diff.filter((l) => !l.reason);
  if (noReason.length) throw ruleViolation(`Bắt buộc giải trình nguyên nhân chênh lệch cho ${noReason.length} dòng (vd: ${noReason.slice(0, 5).map((l) => l.item.code).join(', ')})`);
  await withTx(async (tx) => {
    await transition(tx, 'stocktake', id, ['COUNTING'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    if (diff.length) {
      await createAdjustment(tx, req.user!.id, {
        warehouse_id: doc.warehouse_id, doc_date: toDateOnly(new Date()), reason: `Điều chỉnh theo kiểm kê ${doc.code} – ${doc.name}`,
        source: 'STOCKTAKE', stocktake_id: id, status: 'SUBMITTED',
      }, diff.map((l) => ({ item_id: l.item_id, location_id: l.location_id, bucket: 'USABLE' as const, qty_delta: Number(l.counted_qty!.minus(l.book_qty)), reason: l.reason })));
    }
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, 'COUNTING', 'SUBMITTED', `${diff.length} dòng chênh lệch`);
    await audit(req, 'SUBMIT', ENTITY, doc, undefined, { variance_lines: diff.length }, tx);
    await notifyPermission(tx, ['stocktakes.approve'], req.user!.id, { type: 'APPROVAL', title: `Kiểm kê ${doc.code} chờ phê duyệt (${diff.length} dòng chênh lệch)`, link: `/stocktakes/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED', variance_lines: diff.length });
});

r.post('/:id/approve', requirePerm('stocktakes.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { comment } = z.object({ comment: zOptStr }).parse(req.body ?? {});
  const doc = await prisma.stocktake.findUnique({ where: { id }, include: { adjustment: true } });
  if (!doc) throw notFound();
  if (doc.created_by === req.user!.id && !doc.adjustment) throw ruleViolation('Không được tự phê duyệt đợt kiểm kê do mình tạo');
  if (doc.adjustment && doc.adjustment.status === 'SUBMITTED') {
    await approveAdjustment(req, doc.adjustment.id, comment); // ghi sổ chênh lệch + chuyển kiểm kê sang POSTED
  } else {
    await withTx(async (tx) => {
      await transition(tx, 'stocktake', id, ['SUBMITTED'], { status: 'POSTED', approved_by: req.user!.id, approved_at: new Date() });
      await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'POSTED', comment ?? 'Không có chênh lệch');
      await audit(req, 'APPROVE', ENTITY, doc, undefined, { status: 'POSTED' }, tx);
    });
  }
  ok(res, { id, status: 'POSTED' });
});

r.post('/:id/reject', requirePerm('stocktakes.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stocktake.findUnique({ where: { id }, include: { adjustment: true } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stocktake', id, ['SUBMITTED'], { status: 'COUNTING', reject_reason: reason });
    if (doc.adjustment) {
      await tx.stockAdjustment.update({ where: { id: doc.adjustment.id }, data: { stocktake_id: null, status: 'CANCELLED', cancel_reason: 'Từ chối kết quả kiểm kê: ' + reason, cancelled_by: req.user!.id, cancelled_at: new Date() } });
    }
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, 'SUBMITTED', 'COUNTING', reason);
    await audit(req, 'REJECT', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'COUNTING' });
});

r.post('/:id/cancel', requirePerm('stocktakes.create'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const doc = await prisma.stocktake.findUnique({ where: { id } });
  if (!doc) throw notFound();
  await withTx(async (tx) => {
    await transition(tx, 'stocktake', id, ['DRAFT', 'COUNTING'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
