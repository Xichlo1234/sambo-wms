import { prisma, type Db } from '../db';

/** Giá trị mặc định – KHÔNG tự chọn phương pháp giá xuất kho / tiền tệ hạch toán (chờ công ty xác nhận). */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'company.name': 'SAMBO GOLD',
  'company.address': '',
  'inventory.lock_until': null, // Khóa kỳ: không ghi sổ chứng từ có ngày chứng từ <= ngày này
  'inventory.costing_method': 'NOT_CONFIGURED', // NOT_CONFIGURED | WEIGHTED_AVERAGE | FIFO (chờ phê duyệt)
  'inventory.near_min_ratio': 1.2, // "Sắp hết hàng" khi tồn <= tối thiểu x hệ số
  'inventory.no_movement_days': 90,
  'currency.base': null, // chưa xác nhận đồng tiền hạch toán
  'currency.allowed': ['VND', 'USD', 'LAK', 'THB', 'CNY', 'EUR'],
  'upload.max_mb': 20,
  'issue.require_quota_note': true, // Bắt buộc ghi lý do khi vượt định mức
};

let cache: { at: number; data: Record<string, unknown> } | null = null;

export async function getSettings(db: Db = prisma): Promise<Record<string, unknown>> {
  if (cache && Date.now() - cache.at < 60_000 && db === prisma) return cache.data;
  const rows = await db.systemSetting.findMany();
  const data = { ...DEFAULT_SETTINGS };
  for (const r of rows) data[r.key] = r.value as unknown;
  if (db === prisma) cache = { at: Date.now(), data };
  return data;
}

export function invalidateSettings() {
  cache = null;
}

export async function getSetting<T = unknown>(key: string, db: Db = prisma): Promise<T> {
  const s = await getSettings(db);
  return s[key] as T;
}
