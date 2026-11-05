/**
 * Truy vấn tồn kho – tính trực tiếp từ sổ cái stock_movements (nguồn sự thật) bằng SQL tổng hợp,
 * phân trang ở DB, không tải toàn bộ dữ liệu lên trình duyệt.
 * Kỳ báo cáo tính theo NGÀY GHI SỔ (posted_at).
 * NXT tính trên tồn KHẢ DỤNG (USABLE); tồn chờ kiểm tra / hư hỏng hiển thị riêng.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSetting } from '../lib/settings';
import { normalizeText } from '../lib/text';

export interface NxtParams {
  warehouse_id?: number | null;
  from: Date; // bắt đầu kỳ (00:00)
  to: Date; // kết thúc kỳ (bao gồm cả ngày)
  q?: string;
  category_id?: number | null;
  kind?: string | null;
  stock_status?: string | null;
  only_moved?: boolean;
  limit?: number;
  offset?: number;
}

export type NxtRow = {
  item_id: number;
  code: string;
  name: string;
  specification: string | null;
  category_name: string;
  unit: string;
  location_codes: string | null;
  opening: number;
  qty_in: number;
  qty_out: number;
  closing: number;
  quarantine: number;
  damaged: number;
  reserved: number;
  available: number;
  min_stock: number;
  max_stock: number | null;
  safety_stock: number;
  stock_status: string;
  last_movement_at: Date | null;
};

export const STOCK_STATUS_LABEL: Record<string, string> = {
  OK: 'Còn hàng', LOW: 'Sắp hết hàng', BELOW_MIN: 'Dưới mức tối thiểu', OUT: 'Hết hàng', OVER_MAX: 'Vượt tồn tối đa', PENDING_QC: 'Đang chờ kiểm tra',
};

export function endOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Báo cáo Nhập – Xuất – Tồn / Tồn kho theo kỳ hoặc tại thời điểm (from = to = ngày cần xem) */
export async function queryNxt(p: NxtParams): Promise<{ rows: NxtRow[]; total: number }> {
  const ratio = Number((await getSetting<number>('inventory.near_min_ratio')) ?? 1.2);
  const from = new Date(Date.UTC(p.from.getUTCFullYear(), p.from.getUTCMonth(), p.from.getUTCDate()));
  const to = endOfDay(p.to);
  const wh = p.warehouse_id ?? 0;
  const q = p.q ? normalizeText(p.q) : '';
  const qRaw = p.q?.trim() ?? '';
  const cat = p.category_id ?? 0;
  const kind = p.kind ?? '';
  const status = p.stock_status ?? '';
  const isCurrent = to.getTime() >= Date.now() - 1000;

  const base = Prisma.sql`
    WITH mv AS (
      SELECT m.item_id,
        SUM(CASE WHEN m.bucket = 'USABLE' AND m.posted_at < ${from} THEN m.qty_in - m.qty_out ELSE 0 END) AS opening,
        SUM(CASE WHEN m.bucket = 'USABLE' AND m.posted_at >= ${from} AND m.posted_at <= ${to} THEN m.qty_in ELSE 0 END) AS qty_in,
        SUM(CASE WHEN m.bucket = 'USABLE' AND m.posted_at >= ${from} AND m.posted_at <= ${to} THEN m.qty_out ELSE 0 END) AS qty_out,
        SUM(CASE WHEN m.bucket = 'QUARANTINE' AND m.posted_at <= ${to} THEN m.qty_in - m.qty_out ELSE 0 END) AS quarantine,
        SUM(CASE WHEN m.bucket = 'DAMAGED' AND m.posted_at <= ${to} THEN m.qty_in - m.qty_out ELSE 0 END) AS damaged,
        MAX(m.posted_at) FILTER (WHERE m.posted_at <= ${to}) AS last_movement_at
      FROM stock_movements m
      JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'GENERAL'
      WHERE (${wh}::int = 0 OR m.warehouse_id = ${wh}::int) AND m.posted_at <= ${to}
      GROUP BY m.item_id
    ), res AS (
      SELECT l.item_id, SUM(l.qty_approved) AS reserved
      FROM stock_issue_items l JOIN stock_issues i ON i.id = l.issue_id
      WHERE i.status = 'APPROVED' AND ${isCurrent} AND (${wh}::int = 0 OR i.warehouse_id = ${wh}::int)
      GROUP BY l.item_id
    ), locs AS (
      SELECT b.item_id, string_agg(DISTINCT wl.code, ', ') AS location_codes
      FROM inventory_balances b JOIN warehouse_locations wl ON wl.id = b.location_id
      WHERE (b.qty_usable > 0 OR b.qty_quarantine > 0) AND (${wh}::int = 0 OR b.warehouse_id = ${wh}::int)
      GROUP BY b.item_id
    ), x AS (
      SELECT i.id AS item_id, i.code, i.name, i.specification, c.name AS category_name, u.code AS unit,
        COALESCE(locs.location_codes, dl.code) AS location_codes,
        COALESCE(mv.opening, 0)::float AS opening, COALESCE(mv.qty_in, 0)::float AS qty_in, COALESCE(mv.qty_out, 0)::float AS qty_out,
        (COALESCE(mv.opening, 0) + COALESCE(mv.qty_in, 0) - COALESCE(mv.qty_out, 0))::float AS closing,
        COALESCE(mv.quarantine, 0)::float AS quarantine, COALESCE(mv.damaged, 0)::float AS damaged,
        COALESCE(res.reserved, 0)::float AS reserved,
        (COALESCE(mv.opening, 0) + COALESCE(mv.qty_in, 0) - COALESCE(mv.qty_out, 0) - COALESCE(res.reserved, 0))::float AS available,
        i.min_stock::float AS min_stock, i.max_stock::float AS max_stock, i.safety_stock::float AS safety_stock,
        mv.last_movement_at
      FROM items i
      JOIN item_categories c ON c.id = i.category_id
      JOIN units u ON u.id = i.unit_id
      LEFT JOIN warehouse_locations dl ON dl.id = i.default_location_id
      LEFT JOIN mv ON mv.item_id = i.id
      LEFT JOIN res ON res.item_id = i.id
      LEFT JOIN locs ON locs.item_id = i.id
      WHERE (${q} = '' OR i.search_text LIKE '%' || ${q} || '%' OR i.code ILIKE '%' || ${qRaw} || '%')
        AND (${cat}::int = 0 OR i.category_id = ${cat}::int OR i.subcategory_id = ${cat}::int)
        AND (${kind} = '' OR i.kind::text = ${kind})
        AND (i.status = 'ACTIVE' OR mv.item_id IS NOT NULL)
        AND (${!!p.only_moved} = false OR COALESCE(mv.qty_in, 0) + COALESCE(mv.qty_out, 0) > 0)
    ), y AS (
      SELECT x.*,
        CASE
          WHEN x.closing <= 0 THEN 'OUT'
          WHEN x.closing < x.min_stock THEN 'BELOW_MIN'
          WHEN x.max_stock IS NOT NULL AND x.closing > x.max_stock THEN 'OVER_MAX'
          WHEN x.closing <= GREATEST(x.min_stock * ${ratio}::float, x.safety_stock) THEN 'LOW'
          ELSE 'OK'
        END AS stock_status
      FROM x
    )`;
  const filter = Prisma.sql`WHERE (${status} = '' OR (${status} = 'PENDING_QC' AND y.quarantine > 0) OR y.stock_status = ${status})`;
  const limit = p.limit ?? 100000;
  const offset = p.offset ?? 0;
  const [rows, cnt] = await Promise.all([
    prisma.$queryRaw<NxtRow[]>`${base} SELECT * FROM y ${filter} ORDER BY y.code LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw<{ n: bigint }[]>`${base} SELECT COUNT(*) AS n FROM y ${filter}`,
  ]);
  return { rows, total: Number(cnt[0].n) };
}

export interface CardRow {
  id: string;
  posted_at: Date;
  doc_date: Date;
  doc_code: string;
  doc_type: string;
  doc_id: number;
  movement_type: string;
  bucket: string;
  location_code: string;
  qty_in: number;
  qty_out: number;
  balance: number;
  department: string | null;
  supplier: string | null;
  user_name: string;
  note: string | null;
}

/** Thẻ kho: số dư đầu kỳ + từng giao dịch với tồn sau giao dịch (lũy kế) */
export async function queryStockCard(p: { item_id: number; warehouse_id?: number | null; from: Date; to: Date; bucket?: string }) {
  const from = new Date(Date.UTC(p.from.getUTCFullYear(), p.from.getUTCMonth(), p.from.getUTCDate()));
  const to = endOfDay(p.to);
  const wh = p.warehouse_id ?? 0;
  const bucket = p.bucket || 'USABLE';
  const op = await prisma.$queryRaw<{ v: number }[]>`
    SELECT COALESCE(SUM(qty_in - qty_out), 0)::float AS v FROM stock_movements
    WHERE item_id = ${p.item_id} AND (${wh}::int = 0 OR warehouse_id = ${wh}::int) AND posted_at < ${from}
      AND (${bucket} = 'ALL' OR bucket::text = ${bucket})`;
  const rows = await prisma.$queryRaw<Omit<CardRow, 'balance'>[]>`
    SELECT m.id::text AS id, m.posted_at, m.doc_date, m.doc_code, m.doc_type, m.doc_id, m.movement_type::text AS movement_type, m.bucket::text AS bucket,
      wl.code AS location_code, m.qty_in::float AS qty_in, m.qty_out::float AS qty_out,
      d.name AS department, s.name AS supplier, u.full_name AS user_name, m.note
    FROM stock_movements m
    JOIN warehouse_locations wl ON wl.id = m.location_id
    JOIN users u ON u.id = m.user_id
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    WHERE m.item_id = ${p.item_id} AND (${wh}::int = 0 OR m.warehouse_id = ${wh}::int)
      AND m.posted_at >= ${from} AND m.posted_at <= ${to}
      AND (${bucket} = 'ALL' OR m.bucket::text = ${bucket})
    ORDER BY m.posted_at, m.id
    LIMIT 10000`;
  let bal = op[0].v;
  let tin = 0;
  let tout = 0;
  const out: CardRow[] = rows.map((r) => {
    bal += r.qty_in - r.qty_out;
    tin += r.qty_in;
    tout += r.qty_out;
    return { ...r, balance: Math.round(bal * 10000) / 10000 };
  });
  const item = await prisma.item.findUnique({ where: { id: p.item_id }, include: { unit: true, category: true } });
  return { item, opening: op[0].v, total_in: tin, total_out: tout, closing: Math.round(bal * 10000) / 10000, rows: out };
}

export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Tồn đầu kỳ', RECEIPT: 'Nhập kho', ISSUE: 'Xuất kho', TRANSFER_OUT: 'Điều chuyển đi', TRANSFER_IN: 'Điều chuyển đến',
  RETURN: 'Hàng trả lại', ADJUSTMENT: 'Điều chỉnh', STOCKTAKE: 'Điều chỉnh kiểm kê', INSPECTION: 'Kiểm tra chất lượng',
};
export const BUCKET_TEXT: Record<string, string> = { USABLE: 'Khả dụng', QUARANTINE: 'Chờ kiểm tra', DAMAGED: 'Hư hỏng' };
