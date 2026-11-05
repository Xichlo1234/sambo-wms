import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requirePerm, can } from '../lib/auth';
import { audit } from '../lib/audit';
import { forbidden } from '../lib/errors';
import { ok, pageArgs, pageMeta } from '../lib/http';
import { getSettings, invalidateSettings, DEFAULT_SETTINGS } from '../lib/settings';

export const settingsRouter = Router();
export const auditRouter = Router();
export const notificationsRouter = Router();

// ---------- Cấu hình ----------
settingsRouter.get('/', async (_req, res) => {
  ok(res, await getSettings()); // mọi người dùng đã đăng nhập được đọc (tên công ty, tiền tệ, khóa kỳ)
});

const settingSchemas: Record<string, z.ZodTypeAny> = {
  'company.name': z.string().min(1).max(200),
  'company.address': z.string().max(500),
  'inventory.lock_until': z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng YYYY-MM-DD'), z.null()]),
  'inventory.costing_method': z.enum(['NOT_CONFIGURED', 'WEIGHTED_AVERAGE', 'FIFO']),
  'inventory.near_min_ratio': z.coerce.number().min(1).max(10),
  'inventory.no_movement_days': z.coerce.number().int().min(1).max(3650),
  'currency.base': z.union([z.string().min(3).max(3), z.null()]),
  'currency.allowed': z.array(z.string().min(3).max(3)),
  'upload.max_mb': z.coerce.number().int().min(1).max(100),
  'issue.require_quota_note': z.boolean(),
  'chemical.require_batch': z.boolean(),
  'chemical.require_expiry': z.boolean(),
  'chemical.require_mfg_date': z.boolean(),
  'chemical.require_sds': z.boolean(),
  'chemical.require_safety_verified': z.boolean(),
  'chemical.fefo': z.boolean(),
  'chemical.expiry_alert_days': z.array(z.coerce.number().int().min(1).max(3650)).min(1).max(5),
  'chemical.long_storage_days': z.coerce.number().int().min(30).max(3650),
  'purchase.require_quote_count': z.coerce.number().int().min(0).max(10),
};

settingsRouter.put('/', requirePerm('settings.manage', 'period.lock'), async (req, res) => {
  const body = z.record(z.unknown()).parse(req.body);
  const before = await getSettings();
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    if (k === 'inventory.lock_until' ? !can(req, 'period.lock') : !can(req, 'settings.manage')) throw forbidden(`Không có quyền đổi cấu hình ${k}`);
    const val = settingSchemas[k] ? settingSchemas[k].parse(v) : v;
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: val as object, updated_by: req.user!.id }, update: { value: val as object, updated_by: req.user!.id } });
    changed[k] = val;
  }
  invalidateSettings();
  await audit(req, changed['inventory.lock_until'] !== undefined ? 'PERIOD_LOCK' : 'UPDATE', 'system_setting', { code: Object.keys(changed).join(',').slice(0, 60) },
    Object.fromEntries(Object.keys(changed).map((k) => [k, before[k]])), changed);
  ok(res, await getSettings());
});

// ---------- Nhật ký hoạt động ----------
auditRouter.get('/', requirePerm('audit.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const q = req.query;
  const where = {
    ...(q.user_id ? { user_id: Number(q.user_id) } : {}),
    ...(q.entity_type ? { entity_type: String(q.entity_type) } : {}),
    ...(q.entity_id ? { entity_id: String(q.entity_id) } : {}),
    ...(q.action ? { action: String(q.action) } : {}),
    ...(q.q ? { OR: [{ entity_code: { contains: String(q.q), mode: 'insensitive' as const } }, { username: { contains: String(q.q), mode: 'insensitive' as const } }] } : {}),
    ...(q.from || q.to ? { created_at: { ...(q.from ? { gte: new Date(String(q.from)) } : {}), ...(q.to ? { lte: new Date(String(q.to) + 'T23:59:59Z') } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, skip, take, orderBy: { id: 'desc' } }),
    prisma.auditLog.count({ where }),
  ]);
  ok(res, rows.map((r) => ({ ...r, id: r.id.toString() })), pageMeta(page, pageSize, total));
});

// ---------- Thông báo ----------
notificationsRouter.get('/', async (req, res) => {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { user_id: req.user!.id }, orderBy: { id: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { user_id: req.user!.id, read_at: null } }),
  ]);
  ok(res, { rows, unread });
});
notificationsRouter.post('/read', async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number()).optional() }).parse(req.body ?? {});
  await prisma.notification.updateMany({ where: { user_id: req.user!.id, read_at: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { read_at: new Date() } });
  ok(res, { ok: true });
});
