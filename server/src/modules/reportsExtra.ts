/** Báo cáo Kho hóa chất (10) & Mua hàng (5) */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { can } from '../lib/auth';
import type { ReportDef, P } from './reports';
import { endOfDay } from '../services/stockQueries';
import { sdsStatus, SDS_LABEL, todayUTC, batchBlockReasons } from '../services/chemicals';
import { getSettings } from '../lib/settings';
import { supplierStats } from './purchasing';

const vn = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
const period = (p: P) => `Từ ngày ${vn(p.from)} đến ngày ${vn(p.to)}`;
const QC: Record<string, string> = { PENDING: 'Chờ kiểm tra', PASSED: 'Đạt', QUARANTINE: 'Cách ly', FAILED: 'Không đạt' };
const PS: Record<string, string> = { DRAFT: 'Nháp', SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Từ chối', ORDERED: 'Đã lập PO', SENT: 'Đã gửi NCC', PARTIAL: 'Giao một phần', RECEIVED: 'Đã giao đủ', CLOSED: 'Đã đóng', CANCELLED: 'Đã hủy' };
const PRIO: Record<string, string> = { LOW: 'Thấp', NORMAL: 'Bình thường', HIGH: 'Cao', URGENT: 'Khẩn cấp' };

async function batchRows(where: Prisma.Sql) {
  return prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT c.code AS chem_code, c.name AS chem_name, c.cas_number, u.code AS unit, b.internal_code, b.batch_no, b.mfg_date, b.received_date, b.expiry_date,
      b.qty_received::float AS qty_received, b.qty_on_hand::float AS qty_on_hand, s.name AS supplier, wl.code AS location, b.qc_status::text AS qc_status, b.qc_note,
      b.abnormal, b.abnormal_note, (b.expiry_date - CURRENT_DATE)::int AS days_left
    FROM chemical_batches b JOIN chemicals c ON c.id = b.chemical_id JOIN units u ON u.id = c.unit_id JOIN warehouse_locations wl ON wl.id = b.location_id
    LEFT JOIN suppliers s ON s.id = b.supplier_id
    WHERE ${where} ORDER BY b.expiry_date NULLS LAST, c.code`;
}
const batchCols = [
  { key: 'chem_code', header: 'Mã HC' }, { key: 'chem_name', header: 'Tên hóa chất', width: 28 }, { key: 'internal_code', header: 'Lô nội bộ' }, { key: 'batch_no', header: 'Mã lô NSX' },
  { key: 'mfg_date', header: 'Ngày SX', type: 'date' as const }, { key: 'received_date', header: 'Ngày nhập', type: 'date' as const }, { key: 'expiry_date', header: 'Hạn SD', type: 'date' as const },
  { key: 'days_left', header: 'Còn (ngày)', type: 'number' as const }, { key: 'qty_on_hand', header: 'Tồn lô', type: 'number' as const, total: true }, { key: 'unit', header: 'ĐVT', width: 7 },
  { key: 'location', header: 'Vị trí' }, { key: 'supplier', header: 'Nhà cung cấp' }, { key: 'qc_label', header: 'Trạng thái KT' },
];
const mapQc = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, qc_label: QC[String(r.qc_status)] + (r.abnormal ? ' / bao bì bất thường' : '') }));

export const EXTRA_REPORTS: ReportDef[] = [
  // ======================= KHO HÓA CHẤT =======================
  {
    key: 'chem-stock', group: 'Kho hóa chất', title: 'Tồn kho hóa chất theo từng loại', params: ['q'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.id, c.code, c.name, c.cas_number, c.concentration, u.code AS unit, c.min_stock::float AS min_stock, c.is_controlled,
          COUNT(b.id) FILTER (WHERE b.qty_on_hand > 0)::int AS batches, COALESCE(SUM(b.qty_on_hand),0)::float AS on_hand,
          COALESCE(SUM(b.qty_on_hand) FILTER (WHERE b.qc_status = 'PASSED' AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)),0)::float AS issuable,
          COALESCE(SUM(b.qty_on_hand) FILTER (WHERE b.expiry_date < CURRENT_DATE),0)::float AS expired,
          COALESCE(SUM(b.qty_on_hand) FILTER (WHERE b.qc_status IN ('QUARANTINE','FAILED','PENDING')),0)::float AS blocked,
          MIN(b.expiry_date) FILTER (WHERE b.qty_on_hand > 0) AS nearest_expiry
        FROM chemicals c JOIN units u ON u.id = c.unit_id LEFT JOIN chemical_batches b ON b.chemical_id = c.id
        WHERE c.status = 'ACTIVE' AND (${p.q} = '' OR c.code ILIKE '%' || ${p.q} || '%' OR c.name ILIKE '%' || ${p.q} || '%')
        GROUP BY c.id, u.code ORDER BY c.code`;
      const sds = await sdsStatus(prisma, rows.map((r) => Number(r.id)));
      return {
        title: 'Báo cáo tồn kho hóa chất theo từng loại', subtitle: `Tại ${vn(new Date())}`, landscape: true,
        columns: [{ key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất', width: 30 }, { key: 'cas_number', header: 'CAS' }, { key: 'concentration', header: 'Nồng độ' }, { key: 'unit', header: 'ĐVT', width: 7 },
          { key: 'batches', header: 'Số lô', type: 'number', total: true }, { key: 'on_hand', header: 'Tổng tồn', type: 'number', total: true }, { key: 'issuable', header: 'Được phép xuất', type: 'number', total: true },
          { key: 'expired', header: 'Hết hạn', type: 'number', total: true }, { key: 'blocked', header: 'Cách ly/chưa KT', type: 'number', total: true }, { key: 'min_stock', header: 'Tối thiểu', type: 'number' },
          { key: 'nearest_expiry', header: 'HSD gần nhất', type: 'date' }, { key: 'sds', header: 'SDS/MSDS' }, { key: 'controlled', header: 'Kiểm soát ĐB' }],
        rows: rows.map((r) => ({ ...r, sds: SDS_LABEL[sds.get(Number(r.id))!.state], controlled: r.is_controlled ? 'Có' : '' })),
      };
    },
  },
  {
    key: 'chem-batches', group: 'Kho hóa chất', title: 'Tồn kho hóa chất theo lô', params: ['q', 'supplier_id'],
    run: async (p) => ({ title: 'Báo cáo tồn kho hóa chất theo lô', subtitle: `Tại ${vn(new Date())}`, landscape: true, columns: batchCols,
      rows: mapQc(await batchRows(Prisma.sql`b.qty_on_hand > 0 AND (${p.supplier_id ?? 0}::int = 0 OR b.supplier_id = ${p.supplier_id ?? 0}::int) AND (${p.q} = '' OR c.code ILIKE '%' || ${p.q} || '%' OR c.name ILIKE '%' || ${p.q} || '%' OR b.batch_no ILIKE '%' || ${p.q} || '%')`)) }),
  },
  {
    key: 'chem-nxt', group: 'Kho hóa chất', title: 'Nhập – xuất – tồn hóa chất', params: ['from', 'to', 'q'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.code, c.name, u.code AS unit,
          COALESCE(SUM(m.qty_in - m.qty_out) FILTER (WHERE m.posted_at < ${p.from}),0)::float AS opening,
          COALESCE(SUM(m.qty_in) FILTER (WHERE m.posted_at >= ${p.from} AND m.posted_at <= ${endOfDay(p.to)}),0)::float AS qty_in,
          COALESCE(SUM(m.qty_out) FILTER (WHERE m.posted_at >= ${p.from} AND m.posted_at <= ${endOfDay(p.to)}),0)::float AS qty_out,
          COALESCE(SUM(m.qty_in - m.qty_out) FILTER (WHERE m.posted_at <= ${endOfDay(p.to)}),0)::float AS closing
        FROM chemicals c JOIN units u ON u.id = c.unit_id LEFT JOIN chemical_movements m ON m.chemical_id = c.id
        WHERE (${p.q} = '' OR c.code ILIKE '%' || ${p.q} || '%' OR c.name ILIKE '%' || ${p.q} || '%')
        GROUP BY c.code, c.name, u.code HAVING COUNT(m.id) > 0 ORDER BY c.code`;
      return { title: 'Báo cáo nhập – xuất – tồn hóa chất', subtitle: period(p) + ' (theo ngày ghi sổ, mọi lô)', columns: [{ key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất', width: 32 }, { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'opening', header: 'Tồn đầu kỳ', type: 'number', total: true }, { key: 'qty_in', header: 'Nhập', type: 'number', total: true }, { key: 'qty_out', header: 'Xuất / hủy', type: 'number', total: true }, { key: 'closing', header: 'Tồn cuối kỳ', type: 'number', total: true }], rows };
    },
  },
  {
    key: 'chem-expiring', group: 'Kho hóa chất', title: 'Hóa chất sắp hết hạn', params: ['days'],
    run: async (p) => {
      const s = await getSettings();
      const days = p.days || Math.max(...((s['chemical.expiry_alert_days'] as number[]) ?? [90]));
      return { title: 'Báo cáo hóa chất sắp hết hạn', subtitle: `Hết hạn trong ${days} ngày tới (tính từ ${vn(new Date())})`, landscape: true, columns: batchCols,
        rows: mapQc(await batchRows(Prisma.sql`b.qty_on_hand > 0 AND b.expiry_date >= CURRENT_DATE AND b.expiry_date <= CURRENT_DATE + ${days}::int`)) };
    },
  },
  {
    key: 'chem-expired', group: 'Kho hóa chất', title: 'Hóa chất đã hết hạn', params: [],
    run: async () => ({ title: 'Báo cáo hóa chất đã hết hạn (bị chặn xuất – cần lập phiếu tiêu hủy)', subtitle: `Tại ${vn(new Date())}`, landscape: true, columns: batchCols,
      rows: mapQc(await batchRows(Prisma.sql`b.qty_on_hand > 0 AND b.expiry_date < CURRENT_DATE`)) }),
  },
  {
    key: 'chem-by-supplier', group: 'Kho hóa chất', title: 'Hóa chất theo nhà cung cấp', params: ['from', 'to', 'supplier_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.name AS supplier, c.code, c.name, u.code AS unit, COUNT(DISTINCT b.id)::int AS batches, COALESCE(SUM(b.qty_received),0)::float AS qty_received,
          COALESCE(SUM(b.qty_on_hand),0)::float AS qty_on_hand, COUNT(*) FILTER (WHERE b.qc_status IN ('QUARANTINE','FAILED'))::int AS bad_batches
        FROM chemical_batches b JOIN chemicals c ON c.id = b.chemical_id JOIN units u ON u.id = c.unit_id LEFT JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.received_date >= ${p.from} AND b.received_date <= ${p.to} AND (${p.supplier_id ?? 0}::int = 0 OR b.supplier_id = ${p.supplier_id ?? 0}::int)
        GROUP BY s.name, c.code, c.name, u.code ORDER BY s.name, c.code`;
      return { title: 'Báo cáo hóa chất theo nhà cung cấp', subtitle: period(p) + ' (theo ngày nhập lô)', columns: [{ key: 'supplier', header: 'Nhà cung cấp', width: 26 }, { key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất', width: 28 }, { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'batches', header: 'Số lô', type: 'number', total: true }, { key: 'qty_received', header: 'SL đã nhập', type: 'number', total: true }, { key: 'qty_on_hand', header: 'Còn tồn', type: 'number', total: true }, { key: 'bad_batches', header: 'Lô cách ly/không đạt', type: 'number', total: true }], rows };
    },
  },
  {
    key: 'chem-consumption', group: 'Kho hóa chất', title: 'Tiêu hao hóa chất theo bộ phận', params: ['from', 'to', 'department_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT d.name AS department, c.code, c.name, u.code AS unit, SUM(m.qty_out)::float AS qty, COUNT(DISTINCT m.doc_id)::int AS docs, string_agg(DISTINCT b.internal_code, ', ') AS batches
        FROM chemical_movements m JOIN chemicals c ON c.id = m.chemical_id JOIN units u ON u.id = c.unit_id JOIN departments d ON d.id = m.department_id JOIN chemical_batches b ON b.id = m.batch_id
        WHERE m.movement_type = 'ISSUE' AND m.posted_at >= ${p.from} AND m.posted_at <= ${endOfDay(p.to)} AND (${p.department_id ?? 0}::int = 0 OR m.department_id = ${p.department_id ?? 0}::int)
        GROUP BY d.name, c.code, c.name, u.code ORDER BY d.name, c.code`;
      return { title: 'Báo cáo tiêu hao hóa chất theo bộ phận', subtitle: period(p), landscape: true, columns: [{ key: 'department', header: 'Bộ phận', width: 22 }, { key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất', width: 28 }, { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'qty', header: 'SL đã cấp', type: 'number', total: true }, { key: 'docs', header: 'Số phiếu', type: 'number', total: true }, { key: 'batches', header: 'Các lô đã xuất', width: 30 }], rows };
    },
  },
  {
    key: 'chem-quarantine', group: 'Kho hóa chất', title: 'Hóa chất bị cách ly / không đạt', params: [],
    run: async () => ({ title: 'Báo cáo hóa chất bị cách ly, không đạt, chờ kiểm tra, bao bì bất thường', subtitle: `Tại ${vn(new Date())}`, landscape: true,
      columns: [...batchCols, { key: 'qc_note', header: 'Ghi chú KT', width: 24 }, { key: 'abnormal_note', header: 'Tình trạng bao bì', width: 24 }],
      rows: mapQc(await batchRows(Prisma.sql`b.qty_on_hand > 0 AND (b.qc_status IN ('QUARANTINE','FAILED','PENDING') OR b.abnormal)`)) }),
  },
  {
    key: 'chem-stocktake', group: 'Kho hóa chất', title: 'Kiểm kê hóa chất (chênh lệch theo lô)', params: ['from', 'to'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.code, s.name AS st_name, s.snapshot_at, s.status::text AS status, c.code AS chem_code, c.name AS chem_name, b.internal_code, b.batch_no, b.expiry_date, wl.code AS location, u.code AS unit,
          l.book_qty::float AS book_qty, l.counted_qty::float AS counted_qty, (COALESCE(l.counted_qty,0) - l.book_qty)::float AS variance,
          CASE WHEN l.packaging_ok IS FALSE THEN 'Bất thường: ' || COALESCE(l.packaging_note,'') WHEN l.packaging_ok THEN 'Tốt' ELSE '' END AS packaging, l.reason
        FROM chemical_stocktake_items l JOIN chemical_stocktakes s ON s.id = l.stocktake_id JOIN chemical_batches b ON b.id = l.batch_id JOIN chemicals c ON c.id = b.chemical_id
        JOIN units u ON u.id = c.unit_id JOIN warehouse_locations wl ON wl.id = b.location_id
        WHERE s.snapshot_at >= ${p.from} AND s.snapshot_at <= ${endOfDay(p.to)} AND s.status <> 'CANCELLED' ORDER BY s.code, wl.code, c.code`;
      return { title: 'Báo cáo kiểm kê hóa chất theo lô', subtitle: period(p), landscape: true, columns: [{ key: 'code', header: 'Đợt KK' }, { key: 'location', header: 'Vị trí' }, { key: 'chem_code', header: 'Mã HC' }, { key: 'chem_name', header: 'Tên hóa chất', width: 24 }, { key: 'internal_code', header: 'Lô' }, { key: 'expiry_date', header: 'HSD', type: 'date' }, { key: 'unit', header: 'ĐVT', width: 7 }, { key: 'book_qty', header: 'Tồn sổ', type: 'number', total: true }, { key: 'counted_qty', header: 'Thực tế', type: 'number', total: true }, { key: 'variance', header: 'Chênh lệch', type: 'number', total: true }, { key: 'packaging', header: 'Bao bì' }, { key: 'reason', header: 'Giải trình', width: 24 }], rows };
    },
  },
  {
    key: 'chem-sds', group: 'Kho hóa chất', title: 'Tình trạng SDS/MSDS', params: [],
    run: async () => {
      const chems = await prisma.chemical.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } });
      const sds = await sdsStatus(prisma, chems.map((c) => c.id));
      const docs = await prisma.chemicalSafetyDocument.findMany({ where: { doc_type: 'SDS', status: 'ACTIVE' } });
      const users = await prisma.user.findMany({ where: { id: { in: [...docs.map((d) => d.verified_by), ...chems.map((c) => c.safety_verified_by)].filter(Boolean) as number[] } }, select: { id: true, full_name: true } });
      return {
        title: 'Báo cáo tình trạng SDS/MSDS và xác nhận an toàn', subtitle: `Tại ${vn(new Date())}`, landscape: true,
        summary: [{ label: 'Thiếu / quá hạn SDS', value: [...sds.values()].filter((x) => x.state === 'MISSING' || x.state === 'EXPIRED').length }, { label: 'SDS chưa xác nhận', value: [...sds.values()].filter((x) => x.state === 'UNVERIFIED').length }],
        columns: [{ key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất', width: 28 }, { key: 'cas', header: 'CAS' }, { key: 'sds', header: 'Tình trạng SDS', width: 24 }, { key: 'version', header: 'Phiên bản' }, { key: 'issue_date', header: 'Ngày ban hành', type: 'date' }, { key: 'review_date', header: 'Hạn rà soát', type: 'date' }, { key: 'doc_verifier', header: 'Người xác nhận SDS' }, { key: 'safety', header: 'TT an toàn đã xác nhận' }, { key: 'controlled', header: 'Kiểm soát ĐB' }],
        rows: chems.map((c) => { const st = sds.get(c.id)!; const d = docs.find((x) => x.chemical_id === c.id); return { code: c.code, name: c.name, cas: c.cas_number, sds: SDS_LABEL[st.state], version: d?.version, issue_date: d?.issue_date, review_date: d?.review_date, doc_verifier: users.find((u) => u.id === d?.verified_by)?.full_name, safety: c.safety_verified_at ? `Có (${users.find((u) => u.id === c.safety_verified_by)?.full_name ?? ''})` : 'Chưa', controlled: c.is_controlled ? 'Có' : '' }; }),
      };
    },
  },
  // ======================= MUA HÀNG =======================
  {
    key: 'pr-report', group: 'Mua hàng', title: 'Báo cáo đề nghị mua hàng', params: ['from', 'to', 'department_id', 'status'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT r.code, r.request_date, d.name AS department, u.full_name AS requester, r.purpose, r.priority, r.needed_date, r.status::text AS status,
          COALESCE(i.code, c.code) AS target_code, COALESCE(i.name, c.name, l.description) AS target_name, l.qty::float AS qty, l.unit_code
        FROM purchase_request_items l JOIN purchase_requests r ON r.id = l.request_id JOIN departments d ON d.id = r.department_id JOIN users u ON u.id = r.requester_id
        LEFT JOIN items i ON i.id = l.item_id LEFT JOIN chemicals c ON c.id = l.chemical_id
        WHERE r.request_date >= ${p.from} AND r.request_date <= ${p.to} AND (${p.department_id ?? 0}::int = 0 OR r.department_id = ${p.department_id ?? 0}::int) AND (${p.status} = '' OR r.status::text = ${p.status})
        ORDER BY r.request_date, r.code, l.line_no`;
      return { title: 'Báo cáo đề nghị mua hàng', subtitle: period(p), landscape: true, columns: [{ key: 'code', header: 'Số ĐN' }, { key: 'request_date', header: 'Ngày', type: 'date' }, { key: 'department', header: 'Bộ phận' }, { key: 'requester', header: 'Người đề nghị' }, { key: 'prio', header: 'Ưu tiên' }, { key: 'needed_date', header: 'Ngày cần', type: 'date' }, { key: 'target_code', header: 'Mã hàng' }, { key: 'target_name', header: 'Tên hàng', width: 26 }, { key: 'qty', header: 'SL', type: 'number', total: true }, { key: 'unit_code', header: 'ĐVT' }, { key: 'status_label', header: 'Trạng thái' }],
        rows: rows.map((r) => ({ ...r, prio: PRIO[String(r.priority)], status_label: PS[String(r.status)] })) };
    },
  },
  {
    key: 'po-report', group: 'Mua hàng', title: 'Báo cáo đơn đặt hàng', params: ['from', 'to', 'supplier_id', 'status'],
    run: async (p, req) => {
      const val = can(req, 'purchase.view_value');
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT po.code, po.order_date, po.expected_date, s.name AS supplier, po.status::text AS status, po.currency, po.total_amount::float AS total_amount,
          COUNT(l.id)::int AS lines, SUM(l.qty_ordered)::float AS qty_ordered, SUM(l.qty_received)::float AS qty_received
        FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN purchase_order_items l ON l.order_id = po.id
        WHERE po.order_date >= ${p.from} AND po.order_date <= ${p.to} AND (${p.supplier_id ?? 0}::int = 0 OR po.supplier_id = ${p.supplier_id ?? 0}::int) AND (${p.status} = '' OR po.status::text = ${p.status})
        GROUP BY po.id, s.name ORDER BY po.order_date, po.code`;
      return { title: 'Báo cáo đơn đặt hàng', subtitle: period(p), landscape: true,
        columns: [{ key: 'code', header: 'Số PO' }, { key: 'order_date', header: 'Ngày đặt', type: 'date' }, { key: 'expected_date', header: 'Giao dự kiến', type: 'date' }, { key: 'supplier', header: 'Nhà cung cấp', width: 26 }, { key: 'lines', header: 'Số dòng', type: 'number' }, { key: 'qty_ordered', header: 'SL đặt', type: 'number', total: true }, { key: 'qty_received', header: 'SL đã nhận', type: 'number', total: true },
          ...(val ? [{ key: 'total_amount', header: 'Giá trị', type: 'money' as const, total: true }, { key: 'currency', header: 'Tiền tệ' }] : []), { key: 'status_label', header: 'Trạng thái' }],
        rows: rows.map((r) => ({ ...r, status_label: PS[String(r.status)] })) };
    },
  },
  {
    key: 'po-delivery', group: 'Mua hàng', title: 'Báo cáo tiến độ giao hàng', params: ['supplier_id'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT po.code, s.name AS supplier, po.order_date, po.expected_date, po.status::text AS status, COALESCE(i.code, c.code) AS target_code, COALESCE(i.name, c.name) AS target_name,
          l.qty_ordered::float AS qty_ordered, l.qty_received::float AS qty_received, (l.qty_ordered - l.qty_received)::float AS remaining,
          CASE WHEN po.expected_date < CURRENT_DATE AND l.qty_received < l.qty_ordered THEN (CURRENT_DATE - po.expected_date)::int ELSE 0 END AS days_late
        FROM purchase_order_items l JOIN purchase_orders po ON po.id = l.order_id JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN items i ON i.id = l.item_id LEFT JOIN chemicals c ON c.id = l.chemical_id
        WHERE po.status IN ('APPROVED','SENT','PARTIAL') AND (${p.supplier_id ?? 0}::int = 0 OR po.supplier_id = ${p.supplier_id ?? 0}::int)
        ORDER BY days_late DESC, po.expected_date NULLS LAST`;
      return { title: 'Báo cáo tiến độ giao hàng (đơn đang thực hiện)', subtitle: `Tại ${vn(new Date())}`, landscape: true,
        summary: [{ label: 'Số dòng giao chậm', value: rows.filter((r) => Number(r.days_late) > 0).length }],
        columns: [{ key: 'code', header: 'Số PO' }, { key: 'supplier', header: 'Nhà cung cấp', width: 24 }, { key: 'order_date', header: 'Ngày đặt', type: 'date' }, { key: 'expected_date', header: 'Giao dự kiến', type: 'date' }, { key: 'target_code', header: 'Mã hàng' }, { key: 'target_name', header: 'Tên hàng', width: 24 }, { key: 'qty_ordered', header: 'SL đặt', type: 'number', total: true }, { key: 'qty_received', header: 'Đã nhận', type: 'number', total: true }, { key: 'remaining', header: 'Còn lại', type: 'number', total: true }, { key: 'days_late', header: 'Trễ (ngày)', type: 'number' }, { key: 'status_label', header: 'Trạng thái' }],
        rows: rows.map((r) => ({ ...r, status_label: PS[String(r.status)] })) };
    },
  },
  {
    key: 'purchase-by-supplier', group: 'Mua hàng', title: 'Mua hàng theo nhà cung cấp', params: ['from', 'to'],
    run: async (p, req) => {
      const val = can(req, 'purchase.view_value');
      const sups = await prisma.$queryRaw<{ id: number; code: string; name: string }[]>`SELECT DISTINCT s.id, s.code, s.name FROM suppliers s JOIN purchase_orders po ON po.supplier_id = s.id WHERE po.order_date >= ${p.from} AND po.order_date <= ${p.to} ORDER BY s.name`;
      const rows = [];
      for (const s of sups) { const st = await supplierStats(s.id, p.from, endOfDay(p.to)); rows.push({ code: s.code, name: s.name, ...st, po_value: val ? st.po_value : null }); }
      return { title: 'Báo cáo mua hàng theo nhà cung cấp', subtitle: period(p), landscape: true,
        columns: [{ key: 'code', header: 'Mã NCC' }, { key: 'name', header: 'Nhà cung cấp', width: 28 }, { key: 'po_count', header: 'Số PO', type: 'number', total: true }, ...(val ? [{ key: 'po_value', header: 'Tổng giá trị', type: 'money' as const, total: true }] : []), { key: 'po_completed', header: 'PO giao đủ', type: 'number', total: true }, { key: 'on_time_rate', header: 'Đúng hạn (%)', type: 'number' }, { key: 'shortage_rate', header: 'Giao thiếu (%)', type: 'number' }, { key: 'defect_rate', header: 'Hàng lỗi (%)', type: 'number' }, { key: 'complaints', header: 'Khiếu nại', type: 'number', total: true }],
        rows };
    },
  },
  {
    key: 'supplier-evaluation', group: 'Mua hàng', title: 'Báo cáo đánh giá nhà cung cấp', params: ['from', 'to'],
    run: async (p) => {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT s.code, s.name, e.period_from, e.period_to, e.quality_score, e.delivery_score, e.price_score, e.service_score, e.total_score::float AS total_score, e.classification, u.full_name AS evaluator, e.created_at, e.comment
        FROM supplier_evaluations e JOIN suppliers s ON s.id = e.supplier_id JOIN users u ON u.id = e.evaluator_id
        WHERE e.created_at >= ${p.from} AND e.created_at <= ${endOfDay(p.to)} ORDER BY e.created_at DESC`;
      return { title: 'Báo cáo đánh giá nhà cung cấp', subtitle: period(p), landscape: true, columns: [{ key: 'code', header: 'Mã NCC' }, { key: 'name', header: 'Nhà cung cấp', width: 26 }, { key: 'period_from', header: 'Kỳ từ', type: 'date' }, { key: 'period_to', header: 'Kỳ đến', type: 'date' }, { key: 'quality_score', header: 'Chất lượng', type: 'number' }, { key: 'delivery_score', header: 'Giao hàng', type: 'number' }, { key: 'price_score', header: 'Giá', type: 'number' }, { key: 'service_score', header: 'Dịch vụ', type: 'number' }, { key: 'total_score', header: 'Tổng điểm (/100)', type: 'number' }, { key: 'classification', header: 'Xếp loại' }, { key: 'evaluator', header: 'Người đánh giá' }, { key: 'comment', header: 'Nhận xét', width: 26 }], rows };
    },
  },
];

export { todayUTC, batchBlockReasons };
