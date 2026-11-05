/**
 * HỆ THỐNG BÁO CÁO KHO MỎ (X) – mỗi báo cáo: bộ lọc, tổng hợp, chi tiết, xuất Excel/PDF, in.
 * Báo cáo hóa chất & mua hàng sẽ bổ sung vào cùng danh mục ở Giai đoạn 4, 5.
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requirePerm, can, assertPerm } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { ok } from '../lib/http';
import { audit } from '../lib/audit';
import { computeTotals, toExcel, toPdf, sendFile, type ReportResult, type ReportColumn } from '../lib/report';
import { getSettings } from '../lib/settings';
import { queryNxt, queryStockCard, STOCK_STATUS_LABEL, MOVEMENT_LABEL, BUCKET_TEXT, endOfDay } from '../services/stockQueries';
import { STATUS_LABEL } from '../lib/doc';

const r = Router();

interface P {
  from: Date; to: Date; warehouse_id: number | null; category_id: number | null; department_id: number | null;
  supplier_id: number | null; item_id: number | null; q: string; status: string; kind: string; days: number;
}

function parseParams(q: Request['query']): P {
  const today = new Date();
  const d = (v: unknown, def: Date) => (v ? new Date(String(v)) : def);
  const n = (v: unknown) => (v ? Number(v) : null);
  const p: P = {
    from: d(q.from, new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))),
    to: d(q.to, new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    warehouse_id: n(q.warehouse_id), category_id: n(q.category_id), department_id: n(q.department_id),
    supplier_id: n(q.supplier_id), item_id: n(q.item_id), q: String(q.q || ''), status: String(q.status || ''),
    kind: String(q.kind || ''), days: Number(q.days || 0),
  };
  if (isNaN(p.from.getTime()) || isNaN(p.to.getTime())) throw badRequest('Khoảng thời gian không hợp lệ');
  if (p.from > p.to) throw badRequest('"Từ ngày" phải nhỏ hơn hoặc bằng "Đến ngày"');
  return p;
}

const vn = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const period = (p: P) => `Từ ngày ${vn(p.from)} đến ngày ${vn(p.to)}`;

interface ReportDef {
  key: string;
  group: string;
  title: string;
  params: string[];
  run: (p: P, req: Request) => Promise<ReportResult>;
}

const nxtCols: ReportColumn[] = [
  { key: 'code', header: 'Mã vật tư', width: 14 }, { key: 'name', header: 'Tên vật tư', width: 34 }, { key: 'category_name', header: 'Nhóm', width: 18 },
  { key: 'unit', header: 'ĐVT', width: 8 }, { key: 'opening', header: 'Tồn đầu kỳ', type: 'number', total: true },
  { key: 'qty_in', header: 'Tổng nhập', type: 'number', total: true }, { key: 'qty_out', header: 'Tổng xuất', type: 'number', total: true },
  { key: 'closing', header: 'Tồn cuối kỳ', type: 'number', total: true }, { key: 'location_codes', header: 'Vị trí', width: 14 },
  { key: 'min_stock', header: 'Tồn tối thiểu', type: 'number' }, { key: 'max_stock', header: 'Tồn tối đa', type: 'number' },
  { key: 'status_label', header: 'Trạng thái', width: 16 },
];

const REPORTS: ReportDef[] = [
  {
    key: 'receipts', group: 'Kho mỏ', title: 'Báo cáo nhập kho', params: ['from', 'to', 'supplier_id', 'q'],
    run: async (p, req) => {
      const showValue = can(req, 'stock.view_value');
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT r.code, r.doc_date, r.posted_at, s.name AS supplier, r.po_number, r.supplier_doc_no, i.code AS item_code, i.name AS item_name, u.code AS unit,
          l.qty_doc::float AS qty_doc, l.qty_received::float AS qty_received, l.qty_accepted::float AS qty_accepted, l.qty_pending::float AS qty_pending,
          l.qty_rejected::float AS qty_rejected, l.unit_price::float AS unit_price, l.amount::float AS amount, r.currency, l.condition_note
        FROM stock_receipt_items l JOIN stock_receipts r ON r.id = l.receipt_id JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id
        LEFT JOIN suppliers s ON s.id = r.supplier_id
        WHERE r.status = 'POSTED' AND r.posted_at >= ${p.from} AND r.posted_at <= ${endOfDay(p.to)}
          AND (${p.supplier_id ?? 0}::int = 0 OR r.supplier_id = ${p.supplier_id ?? 0}::int)
          AND (${p.q} = '' OR i.code ILIKE '%' || ${p.q} || '%' OR i.name ILIKE '%' || ${p.q} || '%' OR r.code ILIKE '%' || ${p.q} || '%')
        ORDER BY r.posted_at, r.code, l.line_no`;
      const columns: ReportColumn[] = [
        { key: 'code', header: 'Số phiếu', width: 15 }, { key: 'doc_date', header: 'Ngày CT', type: 'date' }, { key: 'posted_at', header: 'Ngày ghi sổ', type: 'datetime' },
        { key: 'supplier', header: 'Nhà cung cấp', width: 24 }, { key: 'po_number', header: 'Số PO' }, { key: 'item_code', header: 'Mã VT' }, { key: 'item_name', header: 'Tên vật tư', width: 30 },
        { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'qty_doc', header: 'SL chứng từ', type: 'number', total: true }, { key: 'qty_received', header: 'SL thực nhận', type: 'number', total: true },
        { key: 'qty_accepted', header: 'SL nhập tồn', type: 'number', total: true }, { key: 'qty_pending', header: 'Chờ KT', type: 'number', total: true }, { key: 'qty_rejected', header: 'Không đạt', type: 'number', total: true },
        ...(showValue ? [{ key: 'unit_price', header: 'Đơn giá', type: 'money' as const }, { key: 'amount', header: 'Thành tiền', type: 'money' as const, total: true }, { key: 'currency', header: 'Tiền tệ', width: 8 }] : []),
      ];
      return { title: 'Báo cáo nhập kho', subtitle: period(p), columns, rows, landscape: true };
    },
  },
  {
    key: 'issues', group: 'Kho mỏ', title: 'Báo cáo xuất kho', params: ['from', 'to', 'department_id', 'q'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT x.code, x.doc_date, x.issued_at, d.name AS department, x.purpose, x.work_area, i.code AS item_code, i.name AS item_name, u.code AS unit,
          l.qty_requested::float AS qty_requested, l.qty_approved::float AS qty_approved, l.qty_issued::float AS qty_issued,
          rq.full_name AS requester, x.receiver_name, x.status::text AS status
        FROM stock_issue_items l JOIN stock_issues x ON x.id = l.issue_id JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id
        JOIN departments d ON d.id = x.department_id JOIN users rq ON rq.id = x.requester_id
        WHERE x.status IN ('ISSUED','RECEIVED') AND x.issued_at >= ${p.from} AND x.issued_at <= ${endOfDay(p.to)}
          AND (${p.department_id ?? 0}::int = 0 OR x.department_id = ${p.department_id ?? 0}::int)
          AND (${p.q} = '' OR i.code ILIKE '%' || ${p.q} || '%' OR i.name ILIKE '%' || ${p.q} || '%' OR x.code ILIKE '%' || ${p.q} || '%')
        ORDER BY x.issued_at, x.code, l.line_no`;
      return {
        title: 'Báo cáo xuất kho', subtitle: period(p), landscape: true,
        columns: [
          { key: 'code', header: 'Số phiếu', width: 15 }, { key: 'doc_date', header: 'Ngày CT', type: 'date' }, { key: 'issued_at', header: 'Ngày xuất', type: 'datetime' },
          { key: 'department', header: 'Bộ phận', width: 18 }, { key: 'purpose', header: 'Mục đích', width: 24 }, { key: 'work_area', header: 'Khu vực' },
          { key: 'item_code', header: 'Mã VT' }, { key: 'item_name', header: 'Tên vật tư', width: 28 }, { key: 'unit', header: 'ĐVT', width: 7 },
          { key: 'qty_requested', header: 'SL yêu cầu', type: 'number', total: true }, { key: 'qty_approved', header: 'SL duyệt', type: 'number', total: true },
          { key: 'qty_issued', header: 'SL thực xuất', type: 'number', total: true }, { key: 'requester', header: 'Người yêu cầu' }, { key: 'receiver_name', header: 'Người nhận' },
        ],
        rows: rows.map((x) => ({ ...x, status: STATUS_LABEL[String(x.status)] })),
      };
    },
  },
  {
    key: 'nxt', group: 'Kho mỏ', title: 'Báo cáo nhập – xuất – tồn', params: ['from', 'to', 'warehouse_id', 'category_id', 'q', 'kind'],
    run: async (p) => {
      const { rows } = await queryNxt({ from: p.from, to: p.to, warehouse_id: p.warehouse_id, category_id: p.category_id, q: p.q, kind: p.kind || null });
      return { title: 'Báo cáo nhập – xuất – tồn kho', subtitle: period(p) + ' (theo ngày ghi sổ, tồn khả dụng)', columns: nxtCols, rows: rows.map((x) => ({ ...x, status_label: STOCK_STATUS_LABEL[x.stock_status] })), landscape: true };
    },
  },
  {
    key: 'stock-current', group: 'Kho mỏ', title: 'Báo cáo tồn kho hiện tại', params: ['warehouse_id', 'category_id', 'q', 'status'],
    run: async (p) => {
      const now = new Date();
      const { rows } = await queryNxt({ from: now, to: now, warehouse_id: p.warehouse_id, category_id: p.category_id, q: p.q, stock_status: p.status || null });
      return {
        title: 'Báo cáo tồn kho hiện tại', subtitle: `Tại thời điểm ${vn(now)}`, landscape: true,
        columns: [
          { key: 'code', header: 'Mã vật tư', width: 14 }, { key: 'name', header: 'Tên vật tư', width: 34 }, { key: 'category_name', header: 'Nhóm', width: 18 }, { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'closing', header: 'Tồn khả dụng', type: 'number', total: true }, { key: 'reserved', header: 'Đã giữ chỗ', type: 'number', total: true },
          { key: 'available', header: 'Có thể xuất', type: 'number', total: true }, { key: 'quarantine', header: 'Chờ kiểm tra', type: 'number', total: true },
          { key: 'damaged', header: 'Hư hỏng', type: 'number', total: true }, { key: 'location_codes', header: 'Vị trí' }, { key: 'min_stock', header: 'Tối thiểu', type: 'number' },
          { key: 'max_stock', header: 'Tối đa', type: 'number' }, { key: 'status_label', header: 'Trạng thái' },
        ],
        rows: rows.map((x) => ({ ...x, status_label: STOCK_STATUS_LABEL[x.stock_status] + (x.quarantine > 0 ? ' / Chờ KT' : '') })),
      };
    },
  },
  {
    key: 'stock-asof', group: 'Kho mỏ', title: 'Báo cáo tồn kho theo thời điểm', params: ['to', 'warehouse_id', 'category_id', 'q'],
    run: async (p) => {
      const { rows } = await queryNxt({ from: p.to, to: p.to, warehouse_id: p.warehouse_id, category_id: p.category_id, q: p.q });
      return {
        title: 'Báo cáo tồn kho theo thời điểm', subtitle: `Tồn kho tại cuối ngày ${vn(p.to)}`,
        columns: [
          { key: 'code', header: 'Mã vật tư', width: 14 }, { key: 'name', header: 'Tên vật tư', width: 36 }, { key: 'category_name', header: 'Nhóm', width: 18 }, { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'closing', header: 'Tồn khả dụng', type: 'number', total: true }, { key: 'quarantine', header: 'Chờ kiểm tra', type: 'number', total: true }, { key: 'damaged', header: 'Hư hỏng', type: 'number', total: true },
        ],
        rows: rows.filter((x) => x.closing || x.quarantine || x.damaged),
      };
    },
  },
  {
    key: 'below-min', group: 'Kho mỏ', title: 'Báo cáo vật tư dưới mức tồn tối thiểu', params: ['warehouse_id', 'category_id'],
    run: async (p) => {
      const now = new Date();
      const { rows } = await queryNxt({ from: now, to: now, warehouse_id: p.warehouse_id, category_id: p.category_id });
      const list = rows.filter((x) => ['OUT', 'BELOW_MIN', 'LOW'].includes(x.stock_status) && (x.min_stock > 0 || x.safety_stock > 0));
      return {
        title: 'Báo cáo vật tư dưới mức tồn tối thiểu / sắp hết', subtitle: `Tại thời điểm ${vn(now)}`,
        columns: [
          { key: 'code', header: 'Mã vật tư', width: 14 }, { key: 'name', header: 'Tên vật tư', width: 34 }, { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'closing', header: 'Tồn khả dụng', type: 'number' }, { key: 'reserved', header: 'Giữ chỗ', type: 'number' }, { key: 'min_stock', header: 'Tối thiểu', type: 'number' },
          { key: 'safety_stock', header: 'An toàn', type: 'number' }, { key: 'max_stock', header: 'Tối đa', type: 'number' }, { key: 'suggest', header: 'Đề xuất mua (đến mức tối đa)', type: 'number', total: true },
          { key: 'status_label', header: 'Trạng thái' },
        ],
        rows: list.map((x) => ({ ...x, status_label: STOCK_STATUS_LABEL[x.stock_status], suggest: Math.max(0, (x.max_stock ?? x.min_stock * 2) - x.available) })),
      };
    },
  },
  {
    key: 'no-movement', group: 'Kho mỏ', title: 'Báo cáo vật tư không phát sinh giao dịch', params: ['days', 'warehouse_id'],
    run: async (p) => {
      const days = p.days || Number((await getSettings())['inventory.no_movement_days'] ?? 90);
      const since = new Date(Date.now() - days * 86400_000);
      const now = new Date();
      const { rows } = await queryNxt({ from: now, to: now, warehouse_id: p.warehouse_id });
      const list = rows.filter((x) => (x.closing > 0 || x.quarantine > 0 || x.damaged > 0) && (!x.last_movement_at || new Date(x.last_movement_at) < since));
      return {
        title: 'Báo cáo vật tư tồn kho không phát sinh giao dịch', subtitle: `Không có giao dịch trong ${days} ngày (từ ${vn(since)})`,
        columns: [
          { key: 'code', header: 'Mã vật tư', width: 14 }, { key: 'name', header: 'Tên vật tư', width: 36 }, { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'closing', header: 'Tồn khả dụng', type: 'number', total: true }, { key: 'damaged', header: 'Hư hỏng', type: 'number', total: true },
          { key: 'location_codes', header: 'Vị trí' }, { key: 'last_movement_at', header: 'Giao dịch cuối', type: 'datetime' },
        ],
        rows: list,
      };
    },
  },
  {
    key: 'consumption-dept', group: 'Kho mỏ', title: 'Báo cáo tiêu hao theo bộ phận', params: ['from', 'to', 'department_id', 'category_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT d.code AS dept_code, d.name AS department, i.code AS item_code, i.name AS item_name, u.code AS unit,
          SUM(CASE WHEN m.movement_type = 'ISSUE' THEN m.qty_out ELSE 0 END)::float AS issued,
          SUM(CASE WHEN m.movement_type = 'RETURN' THEN m.qty_in ELSE 0 END)::float AS returned,
          (SUM(CASE WHEN m.movement_type = 'ISSUE' THEN m.qty_out ELSE 0 END) - SUM(CASE WHEN m.movement_type = 'RETURN' THEN m.qty_in ELSE 0 END))::float AS net,
          COUNT(DISTINCT m.doc_id) FILTER (WHERE m.movement_type = 'ISSUE')::int AS doc_count
        FROM stock_movements m JOIN departments d ON d.id = m.department_id JOIN items i ON i.id = m.item_id JOIN units u ON u.id = i.unit_id
        WHERE m.movement_type IN ('ISSUE','RETURN') AND m.posted_at >= ${p.from} AND m.posted_at <= ${endOfDay(p.to)}
          AND (${p.department_id ?? 0}::int = 0 OR m.department_id = ${p.department_id ?? 0}::int)
          AND (${p.category_id ?? 0}::int = 0 OR i.category_id = ${p.category_id ?? 0}::int)
        GROUP BY d.code, d.name, i.code, i.name, u.code ORDER BY d.code, i.code`;
      return {
        title: 'Báo cáo tiêu hao vật tư theo bộ phận', subtitle: period(p),
        columns: [
          { key: 'department', header: 'Bộ phận', width: 22 }, { key: 'item_code', header: 'Mã VT', width: 14 }, { key: 'item_name', header: 'Tên vật tư', width: 34 }, { key: 'unit', header: 'ĐVT', width: 8 },
          { key: 'issued', header: 'SL đã cấp', type: 'number', total: true }, { key: 'returned', header: 'SL trả lại', type: 'number', total: true },
          { key: 'net', header: 'Tiêu hao thực', type: 'number', total: true }, { key: 'doc_count', header: 'Số phiếu', type: 'number', total: true },
        ],
        rows,
      };
    },
  },
  {
    key: 'transactions', group: 'Kho mỏ', title: 'Báo cáo lịch sử giao dịch', params: ['from', 'to', 'q', 'department_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT m.posted_at, m.doc_date, m.doc_code, m.movement_type::text AS movement_type, m.bucket::text AS bucket, i.code AS item_code, i.name AS item_name, u.code AS unit,
          wl.code AS location, m.qty_in::float AS qty_in, m.qty_out::float AS qty_out, m.location_balance_after::float AS loc_balance,
          d.name AS department, us.full_name AS user_name, m.note
        FROM stock_movements m JOIN items i ON i.id = m.item_id JOIN units u ON u.id = i.unit_id JOIN warehouse_locations wl ON wl.id = m.location_id
        JOIN users us ON us.id = m.user_id LEFT JOIN departments d ON d.id = m.department_id
        JOIN warehouses w ON w.id = m.warehouse_id AND w.type = 'GENERAL'
        WHERE m.posted_at >= ${p.from} AND m.posted_at <= ${endOfDay(p.to)}
          AND (${p.department_id ?? 0}::int = 0 OR m.department_id = ${p.department_id ?? 0}::int)
          AND (${p.q} = '' OR i.code ILIKE '%' || ${p.q} || '%' OR i.name ILIKE '%' || ${p.q} || '%' OR m.doc_code ILIKE '%' || ${p.q} || '%')
        ORDER BY m.posted_at, m.id LIMIT 20000`;
      return {
        title: 'Báo cáo lịch sử giao dịch kho', subtitle: period(p), landscape: true,
        columns: [
          { key: 'posted_at', header: 'Ngày ghi sổ', type: 'datetime' }, { key: 'doc_date', header: 'Ngày CT', type: 'date' }, { key: 'doc_code', header: 'Chứng từ' },
          { key: 'type_label', header: 'Loại GD' }, { key: 'bucket_label', header: 'Loại tồn' }, { key: 'item_code', header: 'Mã VT' }, { key: 'item_name', header: 'Tên vật tư', width: 28 },
          { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'location', header: 'Vị trí' }, { key: 'qty_in', header: 'Nhập', type: 'number', total: true }, { key: 'qty_out', header: 'Xuất', type: 'number', total: true },
          { key: 'department', header: 'Bộ phận' }, { key: 'user_name', header: 'Người thực hiện' }, { key: 'note', header: 'Ghi chú', width: 24 },
        ],
        rows: rows.map((x) => ({ ...x, type_label: MOVEMENT_LABEL[String(x.movement_type)], bucket_label: BUCKET_TEXT[String(x.bucket)] })),
      };
    },
  },
  {
    key: 'stocktake-variance', group: 'Kho mỏ', title: 'Báo cáo kiểm kê và chênh lệch', params: ['from', 'to'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.code, s.name AS stocktake_name, s.snapshot_at, s.status::text AS status, i.code AS item_code, i.name AS item_name, u.code AS unit, wl.code AS location,
          l.book_qty::float AS book_qty, l.counted_qty::float AS counted_qty, (COALESCE(l.counted_qty, 0) - l.book_qty)::float AS variance, l.reason
        FROM stocktake_items l JOIN stocktakes s ON s.id = l.stocktake_id JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id JOIN warehouse_locations wl ON wl.id = l.location_id
        WHERE s.snapshot_at >= ${p.from} AND s.snapshot_at <= ${endOfDay(p.to)} AND s.status <> 'CANCELLED' AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.book_qty
        ORDER BY s.code, wl.code, i.code`;
      return {
        title: 'Báo cáo kiểm kê và chênh lệch', subtitle: period(p), landscape: true,
        columns: [
          { key: 'code', header: 'Đợt KK' }, { key: 'snapshot_at', header: 'Chốt sổ lúc', type: 'datetime' }, { key: 'status_label', header: 'Trạng thái' },
          { key: 'location', header: 'Vị trí' }, { key: 'item_code', header: 'Mã VT' }, { key: 'item_name', header: 'Tên vật tư', width: 30 }, { key: 'unit', header: 'ĐVT', width: 7 },
          { key: 'book_qty', header: 'Tồn sổ', type: 'number', total: true }, { key: 'counted_qty', header: 'Thực tế', type: 'number', total: true },
          { key: 'variance', header: 'Chênh lệch', type: 'number', total: true }, { key: 'reason', header: 'Giải trình', width: 30 },
        ],
        rows: rows.map((x) => ({ ...x, status_label: STATUS_LABEL[String(x.status)] })),
      };
    },
  },
  {
    key: 'damaged-returns', group: 'Kho mỏ', title: 'Báo cáo hàng hư hỏng, hàng trả lại', params: ['from', 'to', 'department_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT t.code, t.doc_date, t.posted_at, d.name AS department, t.returned_by_name, i.code AS item_code, i.name AS item_name, u.code AS unit,
          l.qty_returned::float AS qty_returned, l.qty_usable::float AS qty_usable, l.qty_damaged::float AS qty_damaged, l.qty_pending::float AS qty_pending,
          COALESCE(l.reason, t.reason) AS reason, l.inspection_note
        FROM stock_return_items l JOIN stock_returns t ON t.id = l.return_id JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id JOIN departments d ON d.id = t.department_id
        WHERE t.status = 'POSTED' AND t.posted_at >= ${p.from} AND t.posted_at <= ${endOfDay(p.to)}
          AND (${p.department_id ?? 0}::int = 0 OR t.department_id = ${p.department_id ?? 0}::int)
        ORDER BY t.posted_at, t.code`;
      const now = new Date();
      const { rows: stock } = await queryNxt({ from: now, to: now });
      const damagedNow = stock.filter((x) => x.damaged > 0 || x.quarantine > 0);
      return {
        title: 'Báo cáo hàng trả lại và hàng hư hỏng', subtitle: period(p), landscape: true,
        summary: [
          { label: 'Số mặt hàng đang có tồn hư hỏng', value: damagedNow.filter((x) => x.damaged > 0).length },
          { label: 'Số mặt hàng đang chờ kiểm tra', value: damagedNow.filter((x) => x.quarantine > 0).length },
        ],
        columns: [
          { key: 'code', header: 'Số phiếu' }, { key: 'posted_at', header: 'Ngày ghi sổ', type: 'datetime' }, { key: 'department', header: 'Bộ phận trả' },
          { key: 'item_code', header: 'Mã VT' }, { key: 'item_name', header: 'Tên vật tư', width: 28 }, { key: 'unit', header: 'ĐVT', width: 7 },
          { key: 'qty_returned', header: 'SL trả', type: 'number', total: true }, { key: 'qty_usable', header: 'Dùng được', type: 'number', total: true },
          { key: 'qty_damaged', header: 'Hư hỏng', type: 'number', total: true }, { key: 'qty_pending', header: 'Chờ xử lý', type: 'number', total: true },
          { key: 'reason', header: 'Lý do', width: 24 }, { key: 'inspection_note', header: 'Kết quả KT', width: 24 },
        ],
        rows,
      };
    },
  },
  {
    key: 'stock-card', group: 'Kho mỏ', title: 'Thẻ kho', params: ['item_id', 'from', 'to', 'warehouse_id'],
    run: async (p) => {
      if (!p.item_id) throw badRequest('Chọn vật tư để xem thẻ kho');
      const c = await queryStockCard({ item_id: p.item_id, warehouse_id: p.warehouse_id, from: p.from, to: p.to });
      if (!c.item) throw notFound('Không tìm thấy vật tư');
      return {
        title: 'Thẻ kho', subtitle: period(p),
        summary: [
          { label: 'Vật tư', value: `${c.item.code} – ${c.item.name}` }, { label: 'Đơn vị tính', value: c.item.unit.code },
          { label: 'Tồn đầu kỳ', value: c.opening.toLocaleString('vi-VN') }, { label: 'Tồn cuối kỳ', value: c.closing.toLocaleString('vi-VN') },
        ],
        columns: [
          { key: 'posted_at', header: 'Ngày giao dịch', type: 'datetime' }, { key: 'doc_code', header: 'Mã chứng từ' }, { key: 'type_label', header: 'Loại giao dịch' },
          { key: 'location_code', header: 'Vị trí' }, { key: 'qty_in', header: 'Nhập', type: 'number', total: true }, { key: 'qty_out', header: 'Xuất', type: 'number', total: true },
          { key: 'balance', header: 'Tồn sau GD', type: 'number' }, { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'party', header: 'Bộ phận / NCC' },
          { key: 'user_name', header: 'Người thực hiện' }, { key: 'note', header: 'Ghi chú', width: 24 },
        ],
        rows: c.rows.map((x) => ({ ...x, type_label: MOVEMENT_LABEL[x.movement_type], unit: c.item!.unit.code, party: x.department ?? x.supplier ?? '' })),
        signatures: ['Người lập', 'Thủ kho', 'Kế toán'],
        landscape: true,
      };
    },
  },
];

r.get('/', requirePerm('reports.view', 'stock.view'), (_req, res) => {
  ok(res, REPORTS.map(({ key, group, title, params }) => ({ key, group, title, params })));
});

r.get('/:key', requirePerm('reports.view', 'stock.view'), async (req, res) => {
  const def = REPORTS.find((x) => x.key === req.params.key);
  if (!def) throw notFound('Không có báo cáo này');
  if (def.key !== 'stock-card') assertPerm(req, 'reports.view');
  const p = parseParams(req.query);
  const result = await def.run(p, req);
  const totals = result.totals ?? computeTotals(result.columns, result.rows);
  const limit = Math.min(Number(req.query.limit) || 1000, 5000);
  ok(res, { ...result, totals, rows: result.rows.slice(0, limit), row_count: result.rows.length, truncated: result.rows.length > limit });
});

r.get('/:key/export', requirePerm('reports.export'), async (req, res) => {
  const def = REPORTS.find((x) => x.key === req.params.key);
  if (!def) throw notFound('Không có báo cáo này');
  const p = parseParams(req.query);
  const result = await def.run(p, req);
  const settings = await getSettings();
  const company = String(settings['company.name'] || 'SAMBO GOLD');
  const fmt = String(req.query.format || 'xlsx');
  const stamp = new Date().toISOString().slice(0, 10);
  await audit(req, 'EXPORT', 'report', { code: def.key }, undefined, { format: fmt, params: req.query });
  if (fmt === 'pdf') return sendFile(res, await toPdf(result, company), `${def.key}_${stamp}.pdf`, 'application/pdf', req.query.inline === '1');
  return sendFile(res, await toExcel(result, company), `${def.key}_${stamp}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

export default r;
export { REPORTS, Prisma };
