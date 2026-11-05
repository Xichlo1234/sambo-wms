import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { requirePerm } from '../lib/auth';
import { audit } from '../lib/audit';
import { AppError, notFound, badRequest } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { normalizeText, escapeLike } from '../lib/text';
import { getAvailability } from '../services/inventory';

const r = Router();

const zOptInt = z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional();
const zOptNum = z.union([z.coerce.number().min(0, 'Không được âm'), z.literal('').transform(() => null), z.null()]).optional();

export const itemSchema = z
  .object({
    code: z.string().trim().min(1, 'Bắt buộc nhập mã vật tư').max(50).transform((s) => s.toUpperCase()),
    name: z.string().trim().min(1, 'Bắt buộc nhập tên vật tư').max(250),
    name_en: zOptStr,
    kind: z.enum(['MATERIAL', 'EQUIPMENT']).default('MATERIAL'),
    category_id: z.coerce.number({ invalid_type_error: 'Chọn nhóm vật tư' }).int().positive('Chọn nhóm vật tư'),
    subcategory_id: zOptInt,
    specification: zOptStr,
    model: zOptStr,
    manufacturer: zOptStr,
    origin: zOptStr,
    unit_id: z.coerce.number({ invalid_type_error: 'Chọn đơn vị tính' }).int().positive('Chọn đơn vị tính'),
    barcode: zOptStr,
    default_location_id: zOptInt,
    min_stock: z.coerce.number().min(0).default(0),
    max_stock: zOptNum,
    safety_stock: z.coerce.number().min(0).default(0),
    max_issue_qty: zOptNum,
    preferred_supplier_id: zOptInt,
    serial_no: zOptStr,
    asset_code: zOptStr,
    note: zOptStr,
    confirm_similar: z.boolean().optional(),
  })
  .refine((d) => d.max_stock == null || d.max_stock >= d.min_stock, { message: 'Tồn tối đa phải ≥ tồn tối thiểu', path: ['max_stock'] });

/** Tìm mặt hàng có tên/quy cách tương tự (pg_trgm) */
export async function findSimilarItems(name: string, spec: string | null | undefined, excludeId?: number) {
  const text = normalizeText(name, spec);
  if (!text) return [];
  return prisma.$queryRaw<{ id: number; code: string; name: string; specification: string | null; score: number }[]>`
    SELECT id, code, name, specification, round(similarity(search_text, ${text})::numeric, 2)::float AS score
    FROM items
    WHERE similarity(search_text, ${text}) >= 0.45 AND id <> ${excludeId ?? 0}
    ORDER BY score DESC LIMIT 8`;
}

const listInclude = {
  category: { select: { id: true, code: true, name: true } },
  unit: { select: { id: true, code: true, name: true } },
  default_location: { select: { id: true, code: true, name: true } },
  preferred_supplier: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ItemInclude;

function buildWhere(q: Request['query']): Prisma.ItemWhereInput {
  const and: Prisma.ItemWhereInput[] = [];
  const s = String(q.q || '').trim();
  if (s) {
    and.push({ OR: [
      { code: { contains: s, mode: 'insensitive' } },
      { search_text: { contains: normalizeText(s) } },
      { barcode: s },
      { name_en: { contains: s, mode: 'insensitive' } },
      { model: { contains: s, mode: 'insensitive' } },
    ] });
  }
  if (q.kind) and.push({ kind: String(q.kind) as 'MATERIAL' | 'EQUIPMENT' });
  if (q.status) and.push({ status: String(q.status) as 'ACTIVE' | 'INACTIVE' });
  if (q.category_id) and.push({ OR: [{ category_id: Number(q.category_id) }, { subcategory_id: Number(q.category_id) }] });
  if (q.supplier_id) and.push({ preferred_supplier_id: Number(q.supplier_id) });
  return and.length ? { AND: and } : {};
}

r.get('/', requirePerm('items.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where = buildWhere(req.query);
  const [rows, total] = await Promise.all([
    prisma.item.findMany({ where, include: listInclude, orderBy: { code: 'asc' }, skip, take }),
    prisma.item.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

/** Tra cứu nhanh cho ô chọn vật tư trên chứng từ – kèm tồn khả dụng nếu có warehouse_id */
r.get('/lookup', requirePerm('items.view'), async (req, res) => {
  const s = String(req.query.q || '').trim();
  const warehouseId = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;
  const where: Prisma.ItemWhereInput = { status: 'ACTIVE' };
  if (req.query.kind) where.kind = String(req.query.kind) as 'MATERIAL';
  if (s) {
    where.OR = [
      { code: { startsWith: s, mode: 'insensitive' } },
      { code: { contains: escapeLike(s), mode: 'insensitive' } },
      { search_text: { contains: normalizeText(s) } },
      { barcode: s },
    ];
  }
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const rows = await prisma.item.findMany({
    where: ids.length ? { id: { in: ids } } : where,
    select: {
      id: true, code: true, name: true, specification: true, max_issue_qty: true, default_location_id: true,
      unit: { select: { code: true } }, kind: true,
    },
    orderBy: { code: 'asc' },
    take: 30,
  });
  let data: unknown[] = rows;
  if (warehouseId && rows.length) {
    const av = await getAvailability(prisma, warehouseId, rows.map((x) => x.id));
    data = rows.map((x) => ({ ...x, available: Number(av.get(x.id)?.available ?? 0), usable: Number(av.get(x.id)?.usable ?? 0) }));
  }
  ok(res, data);
});

r.post('/check-similar', requirePerm('items.create', 'items.update'), async (req, res) => {
  const { name, specification, exclude_id } = z
    .object({ name: z.string().default(''), specification: z.string().nullish(), exclude_id: z.coerce.number().optional() })
    .parse(req.body);
  ok(res, await findSimilarItems(name, specification, exclude_id));
});

r.get('/:id', requirePerm('items.view'), async (req, res) => {
  const id = Number(req.params.id);
  const item = await prisma.item.findUnique({ where: { id }, include: listInclude });
  if (!item) throw notFound('Không tìm thấy vật tư');
  const balances = await prisma.inventoryBalance.findMany({
    where: { item_id: id },
    include: { warehouse: { select: { code: true, name: true } }, location: { select: { code: true, name: true } } },
    orderBy: [{ warehouse_id: 'asc' }, { location_id: 'asc' }],
  });
  ok(res, { ...item, balances });
});

async function validateRefs(d: z.infer<typeof itemSchema>) {
  const [cat, unit] = await Promise.all([
    prisma.itemCategory.findUnique({ where: { id: d.category_id } }),
    prisma.unit.findUnique({ where: { id: d.unit_id } }),
  ]);
  if (!cat || cat.status !== 'ACTIVE') throw badRequest('Nhóm vật tư không tồn tại hoặc đã bị khóa');
  if (!unit || unit.status !== 'ACTIVE') throw badRequest('Đơn vị tính không tồn tại hoặc đã bị khóa');
  if (d.subcategory_id) {
    const sub = await prisma.itemCategory.findUnique({ where: { id: d.subcategory_id } });
    if (!sub || sub.parent_id !== d.category_id) throw badRequest('Phân nhóm không thuộc nhóm vật tư đã chọn');
  }
}

r.post('/', requirePerm('items.create'), async (req, res) => {
  const { confirm_similar, ...d } = itemSchema.parse(req.body);
  await validateRefs(d as z.infer<typeof itemSchema>);
  const dup = await prisma.item.findUnique({ where: { code: d.code } });
  if (dup) throw new AppError(409, 'DUPLICATE', `Mã vật tư ${d.code} đã tồn tại (${dup.name}). Không được tạo trùng mã.`);
  if (!confirm_similar) {
    const similar = await findSimilarItems(d.name, d.specification);
    if (similar.length) {
      throw new AppError(409, 'SIMILAR_ITEMS', 'Phát hiện mặt hàng có tên/quy cách tương tự. Kiểm tra để tránh tạo trùng; nếu chắc chắn là mặt hàng khác, hãy xác nhận tạo mới.', similar);
    }
  }
  const item = await prisma.item.create({
    data: { ...d, search_text: normalizeText(d.name, d.specification, d.name_en, d.model), created_by: req.user!.id, updated_by: req.user!.id },
  });
  await audit(req, 'CREATE', 'item', { id: item.id, code: item.code }, undefined, item);
  ok(res, item);
});

r.put('/:id', requirePerm('items.update'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.item.findUnique({ where: { id } });
  if (!before) throw notFound('Không tìm thấy vật tư');
  const { confirm_similar, ...d } = itemSchema.parse(req.body);
  await validateRefs(d as z.infer<typeof itemSchema>);
  if (d.code !== before.code) {
    const used = await prisma.stockMovement.count({ where: { item_id: id } });
    if (used) throw badRequest('Mã vật tư đã phát sinh giao dịch – không được đổi mã. Có thể sửa các thông tin khác.');
  }
  if (!confirm_similar && (d.name !== before.name || d.specification !== before.specification)) {
    const similar = await findSimilarItems(d.name, d.specification, id);
    if (similar.length) throw new AppError(409, 'SIMILAR_ITEMS', 'Phát hiện mặt hàng có tên/quy cách tương tự. Xác nhận nếu vẫn muốn lưu.', similar);
  }
  const item = await prisma.item.update({
    where: { id },
    data: { ...d, search_text: normalizeText(d.name, d.specification, d.name_en, d.model), updated_by: req.user!.id },
  });
  await audit(req, 'UPDATE', 'item', { id, code: item.code }, before, item);
  ok(res, item);
});

r.patch('/:id/status', requirePerm('items.lock'), async (req, res) => {
  const id = Number(req.params.id);
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
  const item = await prisma.item.update({ where: { id }, data: { status, updated_by: req.user!.id } });
  await audit(req, status === 'ACTIVE' ? 'UNLOCK' : 'LOCK', 'item', { id, code: item.code }, undefined, { status });
  ok(res, item);
});

export default r;
