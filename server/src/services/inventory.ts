/**
 * BỘ MÁY GHI SỔ KHO (Posting Engine)
 *
 * Nguyên tắc:
 *  1. Mọi biến động tồn kho chỉ đi qua postMovements() và luôn chạy BÊN TRONG một transaction của chứng từ
 *     → chứng từ đổi trạng thái + sổ cái + số dư cùng thành công hoặc cùng thất bại (nguyên tử).
 *  2. Khóa advisory theo (kho, mặt hàng) – sắp xếp tăng dần để tránh deadlock → hai người thao tác đồng thời
 *     trên cùng mặt hàng sẽ được tuần tự hóa, không phát sinh sai lệch tồn.
 *  3. Xuất dùng UPDATE có điều kiện (tồn >= SL xuất) + CHECK constraint ở DB → không bao giờ âm kho.
 *  4. Tồn khả dụng = tồn USABLE – SL đã được duyệt cấp nhưng chưa xuất (giữ chỗ).
 *  5. Khóa kỳ: không ghi sổ chứng từ có ngày chứng từ <= ngày khóa.
 */
import { Prisma, type MovementType, type StockBucket } from '@prisma/client';
import { prisma, type Db, type Tx } from '../db';
import { ruleViolation } from '../lib/errors';
import { getSetting } from '../lib/settings';

const BUCKET_COL: Record<StockBucket, string> = {
  USABLE: 'qty_usable',
  QUARANTINE: 'qty_quarantine',
  DAMAGED: 'qty_damaged',
};

export const BUCKET_LABEL: Record<StockBucket, string> = {
  USABLE: 'khả dụng',
  QUARANTINE: 'chờ kiểm tra',
  DAMAGED: 'hư hỏng',
};

export interface MoveInput {
  warehouse_id: number;
  location_id: number;
  item_id: number;
  bucket: StockBucket;
  direction: 'IN' | 'OUT';
  qty: number | Prisma.Decimal;
  movement_type: MovementType;
  doc_type: string;
  doc_id: number;
  doc_code: string;
  doc_line_id?: number | null;
  doc_date: Date;
  department_id?: number | null;
  supplier_id?: number | null;
  unit_cost?: number | Prisma.Decimal | null;
  note?: string | null;
}

export interface PostOptions {
  /** Phiếu xuất đang ghi sổ – giữ chỗ của chính nó không tính vào "đã giữ chỗ" */
  excludeIssueId?: number;
  /** Bỏ kiểm tra giữ chỗ (chỉ dùng cho nghiệp vụ không làm giảm khả dụng của người khác) */
  skipReservationCheck?: boolean;
}

const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

export function toDateOnly(d: Date) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** Kiểm tra khóa kỳ */
export async function assertPeriodOpen(db: Db, docDate: Date) {
  const lockUntil = await getSetting<string | null>('inventory.lock_until', db);
  if (!lockUntil) return;
  const lock = new Date(lockUntil + 'T23:59:59.999Z');
  if (docDate.getTime() <= lock.getTime()) {
    throw ruleViolation(
      `Kỳ kho đã khóa đến hết ngày ${lockUntil.split('-').reverse().join('/')}. Không thể ghi sổ chứng từ ngày ${docDate.toISOString().slice(0, 10).split('-').reverse().join('/')}. ` +
        'Hãy dùng ngày chứng từ sau ngày khóa hoặc đề nghị người có thẩm quyền mở khóa kỳ.',
    );
  }
}

/** Khóa advisory theo (kho, mặt hàng) – tự giải phóng khi transaction kết thúc */
export async function lockItems(tx: Tx, keys: { warehouse_id: number; item_id: number }[]) {
  const uniq = [...new Map(keys.map((k) => [`${k.warehouse_id}:${k.item_id}`, k])).values()].sort(
    (a, b) => a.warehouse_id - b.warehouse_id || a.item_id - b.item_id,
  );
  for (const k of uniq) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${k.warehouse_id}::int, ${k.item_id}::int)`;
  }
}

/** SL đã được duyệt cấp nhưng chưa xuất (giữ chỗ) theo mặt hàng */
export async function getReserved(db: Db, warehouseId: number, itemIds: number[], excludeIssueId?: number) {
  const map = new Map<number, Prisma.Decimal>();
  if (!itemIds.length) return map;
  const rows = await db.$queryRaw<{ item_id: number; qty: Prisma.Decimal }[]>`
    SELECT l.item_id, COALESCE(SUM(l.qty_approved), 0) AS qty
    FROM stock_issue_items l JOIN stock_issues i ON i.id = l.issue_id
    WHERE i.status = 'APPROVED' AND i.warehouse_id = ${warehouseId}
      AND l.item_id IN (${Prisma.join(itemIds)})
      AND (${excludeIssueId ?? 0}::int = 0 OR i.id <> ${excludeIssueId ?? 0}::int)
    GROUP BY l.item_id`;
  for (const r of rows) map.set(r.item_id, D(r.qty));
  return map;
}

/** Tồn khả dụng theo mặt hàng (toàn kho) = USABLE – giữ chỗ */
export async function getAvailability(db: Db, warehouseId: number, itemIds: number[], excludeIssueId?: number) {
  const result = new Map<number, { usable: Prisma.Decimal; reserved: Prisma.Decimal; available: Prisma.Decimal }>();
  if (!itemIds.length) return result;
  const bal = await db.inventoryBalance.groupBy({
    by: ['item_id'],
    where: { warehouse_id: warehouseId, item_id: { in: itemIds } },
    _sum: { qty_usable: true },
  });
  const reserved = await getReserved(db, warehouseId, itemIds, excludeIssueId);
  for (const id of itemIds) {
    const usable = D(bal.find((b) => b.item_id === id)?._sum.qty_usable ?? 0);
    const res = reserved.get(id) ?? D(0);
    result.set(id, { usable, reserved: res, available: usable.minus(res) });
  }
  return result;
}

/**
 * Ghi sổ danh sách biến động. PHẢI gọi trong transaction.
 * Trả về các bản ghi stock_movements đã tạo (để kiểm tra / hiển thị).
 */
export async function postMovements(tx: Tx, userId: number, moves: MoveInput[], opts: PostOptions = {}) {
  if (!moves.length) return [];
  for (const m of moves) {
    if (D(m.qty).lte(0)) throw ruleViolation('Số lượng ghi sổ phải lớn hơn 0');
  }
  const docDates = [...new Set(moves.map((m) => m.doc_date.getTime()))];
  for (const t of docDates) await assertPeriodOpen(tx, new Date(t));

  await lockItems(tx, moves);

  const itemIds = [...new Set(moves.map((m) => m.item_id))];
  const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, code: true, name: true } });
  const itemInfo = new Map(items.map((i) => [i.id, i]));
  const now = new Date();
  const rows: Prisma.StockMovementCreateManyInput[] = [];

  for (const m of moves) {
    const col = BUCKET_COL[m.bucket];
    const qty = D(m.qty);
    let locBal: Prisma.Decimal;
    if (m.direction === 'IN') {
      const r = await tx.$queryRawUnsafe<{ v: Prisma.Decimal }[]>(
        `INSERT INTO inventory_balances (warehouse_id, location_id, item_id, ${col}, last_movement_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4::numeric, now(), now(), now())
         ON CONFLICT (warehouse_id, location_id, item_id)
         DO UPDATE SET ${col} = inventory_balances.${col} + EXCLUDED.${col}, last_movement_at = now(), updated_at = now()
         RETURNING ${col} AS v`,
        m.warehouse_id, m.location_id, m.item_id, qty.toString(),
      );
      locBal = D(r[0].v);
    } else {
      const r = await tx.$queryRawUnsafe<{ v: Prisma.Decimal }[]>(
        `UPDATE inventory_balances SET ${col} = ${col} - $4::numeric, last_movement_at = now(), updated_at = now()
         WHERE warehouse_id = $1 AND location_id = $2 AND item_id = $3 AND ${col} >= $4::numeric
         RETURNING ${col} AS v`,
        m.warehouse_id, m.location_id, m.item_id, qty.toString(),
      );
      if (!r.length) {
        const cur = await tx.inventoryBalance.findUnique({
          where: { warehouse_id_location_id_item_id: { warehouse_id: m.warehouse_id, location_id: m.location_id, item_id: m.item_id } },
        });
        const have = cur ? D((cur as unknown as Record<string, Prisma.Decimal>)[col]) : D(0);
        const loc = await tx.warehouseLocation.findUnique({ where: { id: m.location_id }, select: { code: true } });
        const it = itemInfo.get(m.item_id);
        throw ruleViolation(
          `Không đủ tồn ${BUCKET_LABEL[m.bucket]} để xuất: ${it?.code} – ${it?.name} tại vị trí ${loc?.code}. ` +
            `Tồn hiện có ${have.toString()}, cần ${qty.toString()}. Không được xuất âm kho.`,
          { item_id: m.item_id, location_id: m.location_id, available: Number(have), required: Number(qty) },
        );
      }
      locBal = D(r[0].v);
      if (m.bucket === 'USABLE' && !opts.skipReservationCheck) {
        const av = (await getAvailability(tx, m.warehouse_id, [m.item_id], opts.excludeIssueId)).get(m.item_id)!;
        if (av.available.lt(0)) {
          const it = itemInfo.get(m.item_id);
          throw ruleViolation(
            `Mặt hàng ${it?.code} – ${it?.name}: số lượng này đã được giữ chỗ cho phiếu xuất khác đã duyệt ` +
              `(giữ chỗ ${av.reserved.toString()}, tồn ${av.usable.plus(qty).toString()}). Không thể xuất/giảm thêm ${qty.toString()}.`,
          );
        }
      }
    }
    const tot = await tx.$queryRawUnsafe<{ v: Prisma.Decimal }[]>(
      `SELECT COALESCE(SUM(${col}), 0) AS v FROM inventory_balances WHERE warehouse_id = $1 AND item_id = $2`,
      m.warehouse_id, m.item_id,
    );
    rows.push({
      warehouse_id: m.warehouse_id,
      location_id: m.location_id,
      item_id: m.item_id,
      bucket: m.bucket,
      movement_type: m.movement_type,
      qty_in: m.direction === 'IN' ? qty : D(0),
      qty_out: m.direction === 'OUT' ? qty : D(0),
      balance_after: D(tot[0].v),
      location_balance_after: locBal,
      unit_cost: m.unit_cost != null ? D(m.unit_cost) : null,
      doc_type: m.doc_type,
      doc_id: m.doc_id,
      doc_code: m.doc_code,
      doc_line_id: m.doc_line_id ?? null,
      doc_date: m.doc_date,
      posted_at: now,
      department_id: m.department_id ?? null,
      supplier_id: m.supplier_id ?? null,
      user_id: userId,
      note: m.note ?? null,
    });
  }
  await tx.stockMovement.createMany({ data: rows });
  return rows;
}

/** Đối chiếu số dư với sổ cái – phục vụ kiểm tra toàn vẹn dữ liệu */
export async function reconcile(db: Db = prisma) {
  return db.$queryRaw<
    { warehouse_id: number; location_id: number; item_id: number; bucket: string; balance: Prisma.Decimal; ledger: Prisma.Decimal }[]
  >`
    WITH ledger AS (
      SELECT warehouse_id, location_id, item_id, bucket::text AS bucket, SUM(qty_in - qty_out) AS qty
      FROM stock_movements GROUP BY 1,2,3,4
    ), bal AS (
      SELECT warehouse_id, location_id, item_id, 'USABLE' AS bucket, qty_usable AS qty FROM inventory_balances
      UNION ALL SELECT warehouse_id, location_id, item_id, 'QUARANTINE', qty_quarantine FROM inventory_balances
      UNION ALL SELECT warehouse_id, location_id, item_id, 'DAMAGED', qty_damaged FROM inventory_balances
    )
    SELECT COALESCE(b.warehouse_id, l.warehouse_id) AS warehouse_id, COALESCE(b.location_id, l.location_id) AS location_id,
           COALESCE(b.item_id, l.item_id) AS item_id, COALESCE(b.bucket, l.bucket) AS bucket,
           COALESCE(b.qty, 0) AS balance, COALESCE(l.qty, 0) AS ledger
    FROM bal b FULL OUTER JOIN ledger l
      ON b.warehouse_id = l.warehouse_id AND b.location_id = l.location_id AND b.item_id = l.item_id AND b.bucket = l.bucket
    WHERE COALESCE(b.qty, 0) <> COALESCE(l.qty, 0)`;
}
