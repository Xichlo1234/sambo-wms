import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requirePerm } from '../lib/auth';
import { ok, pageArgs, pageMeta } from '../lib/http';
import { badRequest } from '../lib/errors';
import { queryNxt, queryStockCard } from '../services/stockQueries';
import { getReserved, reconcile } from '../services/inventory';

const r = Router();

/** Tồn kho theo thời gian thực / theo kỳ / tại thời điểm quá khứ (as_of) */
r.get('/balances', requirePerm('stock.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const q = req.query;
  const today = new Date();
  const asOf = q.as_of ? new Date(String(q.as_of)) : null;
  const from = asOf ?? (q.from ? new Date(String(q.from)) : new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
  const to = asOf ?? (q.to ? new Date(String(q.to)) : today);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest('Ngày không hợp lệ');
  const { rows, total } = await queryNxt({
    from, to, warehouse_id: q.warehouse_id ? Number(q.warehouse_id) : null, q: String(q.q || ''),
    category_id: q.category_id ? Number(q.category_id) : null, kind: q.kind ? String(q.kind) : null,
    stock_status: q.stock_status ? String(q.stock_status) : null, limit: take, offset: skip,
  });
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/card', requirePerm('stock.view'), async (req, res) => {
  const p = z.object({
    item_id: z.coerce.number().int().positive('Chọn vật tư'),
    warehouse_id: z.coerce.number().int().optional(),
    from: z.coerce.date(), to: z.coerce.date(),
    bucket: z.enum(['USABLE', 'QUARANTINE', 'DAMAGED', 'ALL']).default('USABLE'),
  }).parse(req.query);
  ok(res, await queryStockCard(p));
});

/** Tồn theo vị trí của một mặt hàng – dùng khi chọn vị trí xuất kho / điều chuyển */
r.get('/locations', requirePerm('stock.view', 'issues.issue'), async (req, res) => {
  const itemId = Number(req.query.item_id);
  const warehouseId = Number(req.query.warehouse_id);
  if (!itemId || !warehouseId) throw badRequest('Thiếu item_id / warehouse_id');
  const rows = await prisma.inventoryBalance.findMany({
    where: { item_id: itemId, warehouse_id: warehouseId },
    include: { location: { select: { id: true, code: true, name: true } } },
    orderBy: { qty_usable: 'desc' },
  });
  const reserved = (await getReserved(prisma, warehouseId, [itemId])).get(itemId);
  ok(res, { reserved: Number(reserved ?? 0), locations: rows.map((b) => ({ location_id: b.location_id, code: b.location.code, name: b.location.name, qty_usable: Number(b.qty_usable), qty_quarantine: Number(b.qty_quarantine), qty_damaged: Number(b.qty_damaged) })) });
});

/** Đối chiếu số dư với sổ cái – kết quả rỗng nghĩa là dữ liệu nhất quán */
r.get('/reconcile', requirePerm('stock.view'), async (_req, res) => {
  const diff = await reconcile();
  ok(res, { consistent: diff.length === 0, differences: diff });
});

export default r;
