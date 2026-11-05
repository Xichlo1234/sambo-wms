/**
 * MẪU BIỂU IN (PDF tiếng Việt): Phiếu nhập kho, Phiếu xuất kho, Biên bản kiểm kê, Phiếu điều chuyển,
 * Phiếu nhập hàng trả lại, Phiếu điều chỉnh. Có ô ký tên theo quy trình.
 */
import { Router, type Request } from 'express';
import { prisma } from '../db';
import { can, requirePerm } from '../lib/auth';
import { forbidden, notFound } from '../lib/errors';
import { toPdf, sendFile, type ReportResult } from '../lib/report';
import { getSettings } from '../lib/settings';
import { STATUS_LABEL } from '../lib/doc';
import { audit } from '../lib/audit';

const r = Router();
const vn = (d?: Date | null) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '');
const vnt = (d?: Date | null) => (d ? new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : '');
const n = (v: unknown) => (v == null ? null : Number(v));

async function build(type: string, id: number, req: Request): Promise<ReportResult> {
  switch (type) {
    case 'receipt': {
      if (!can(req, 'receipts.view')) throw forbidden();
      const d = await prisma.stockReceipt.findUnique({ where: { id }, include: { supplier: true, warehouse: true, creator: true, approver: true, department: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      const val = can(req, 'stock.view_value');
      return {
        title: 'PHIẾU NHẬP KHO', subtitle: `Số: ${d.code} – Ngày chứng từ: ${vn(d.doc_date)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [
          { label: 'Kho', value: `${d.warehouse.code} – ${d.warehouse.name}` }, { label: 'Nhà cung cấp', value: d.supplier ? `${d.supplier.code} – ${d.supplier.name}` : '' },
          { label: 'Số PO / Hóa đơn', value: `${d.po_number ?? ''} / ${d.supplier_doc_no ?? ''}` }, { label: 'Ngày nhận thực tế', value: vn(d.received_date) },
          { label: 'Người giao hàng', value: d.deliverer_name ?? '' }, { label: 'Người nhận hàng', value: d.receiver_name ?? d.creator.full_name },
          { label: 'Người lập / Người duyệt', value: `${d.creator.full_name} / ${d.approver?.full_name ?? ''} ${d.approved_at ? '(' + vnt(d.approved_at) + ')' : ''}` },
          { label: 'Ghi chú', value: d.note ?? '' },
        ],
        columns: [
          { key: 'line_no', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư, quy cách' }, { key: 'unit', header: 'ĐVT' },
          { key: 'location', header: 'Vị trí' }, { key: 'qty_doc', header: 'SL chứng từ', type: 'number', total: true }, { key: 'qty_received', header: 'SL thực nhận', type: 'number', total: true },
          { key: 'qty_accepted', header: 'SL nhập kho', type: 'number', total: true }, { key: 'qty_pending', header: 'Chờ KT', type: 'number' }, { key: 'qty_rejected', header: 'Không đạt', type: 'number' },
          ...(val ? [{ key: 'unit_price', header: 'Đơn giá', type: 'money' as const }, { key: 'amount', header: 'Thành tiền', type: 'money' as const, total: true }] : []),
          { key: 'condition', header: 'Tình trạng' },
        ],
        rows: d.lines.map((l) => ({ line_no: l.line_no, code: l.item.code, name: l.item.name + (l.item.specification ? ` (${l.item.specification})` : ''), unit: l.item.unit.code, location: l.location.code, qty_doc: n(l.qty_doc), qty_received: n(l.qty_received), qty_accepted: n(l.qty_accepted), qty_pending: n(l.qty_pending), qty_rejected: n(l.qty_rejected), unit_price: n(l.unit_price), amount: n(l.amount), condition: [l.condition_note, l.note].filter(Boolean).join('; ') })),
        signatures: ['Người giao hàng', 'Người lập phiếu', 'Thủ kho', 'Quản lý kho'], landscape: true,
      };
    }
    case 'issue': {
      if (!can(req, 'issues.view') && !can(req, 'issues.view_all')) throw forbidden();
      const d = await prisma.stockIssue.findUnique({ where: { id }, include: { department: true, warehouse: true, requester: true, approver: true, issuer: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      if (!can(req, 'issues.view_all') && d.requester_id !== req.user!.id && d.department_id !== req.user!.department_id) throw forbidden();
      return {
        title: d.status === 'ISSUED' || d.status === 'RECEIVED' ? 'PHIẾU XUẤT KHO' : 'PHIẾU YÊU CẦU CẤP VẬT TƯ', subtitle: `Số: ${d.code} – Ngày chứng từ: ${vn(d.doc_date)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [
          { label: 'Bộ phận nhận', value: `${d.department.code} – ${d.department.name}` }, { label: 'Mục đích sử dụng', value: d.purpose }, { label: 'Công trình / khu vực', value: d.work_area ?? '' },
          { label: 'Người yêu cầu', value: d.requester.full_name }, { label: 'Người phê duyệt', value: `${d.approver?.full_name ?? ''} ${d.approved_at ? '(' + vnt(d.approved_at) + ')' : ''}` },
          { label: 'Người xuất kho / Ngày xuất', value: `${d.issuer?.full_name ?? ''} ${d.issued_at ? '(' + vnt(d.issued_at) + ')' : ''}` },
          { label: 'Người nhận', value: `${d.receiver_name ?? ''}${d.receive_confirmed_at ? ` – đã xác nhận điện tử "${d.receive_signature}" lúc ${vnt(d.receive_confirmed_at)}` : ''}` },
        ],
        columns: [
          { key: 'line_no', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư, quy cách' }, { key: 'unit', header: 'ĐVT' },
          { key: 'qty_requested', header: 'SL yêu cầu', type: 'number', total: true }, { key: 'qty_approved', header: 'SL duyệt', type: 'number', total: true },
          { key: 'qty_issued', header: 'SL thực xuất', type: 'number', total: true }, { key: 'location', header: 'Vị trí' }, { key: 'note', header: 'Ghi chú' },
        ],
        rows: d.lines.map((l) => ({ line_no: l.line_no, code: l.item.code, name: l.item.name + (l.item.specification ? ` (${l.item.specification})` : ''), unit: l.item.unit.code, qty_requested: n(l.qty_requested), qty_approved: n(l.qty_approved), qty_issued: n(l.qty_issued), location: l.location?.code ?? '', note: l.note ?? '' })),
        signatures: ['Người yêu cầu', 'Người phê duyệt', 'Thủ kho xuất', 'Người nhận'],
      };
    }
    case 'stocktake': {
      if (!can(req, 'stocktakes.view')) throw forbidden();
      const d = await prisma.stocktake.findUnique({ where: { id }, include: { warehouse: true, creator: true, adjustment: true, lines: { orderBy: [{ location_id: 'asc' }, { item_id: 'asc' }], include: { item: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      return {
        title: 'BIÊN BẢN KIỂM KÊ KHO', subtitle: `Số: ${d.code} – ${d.name} – Chốt sổ lúc: ${vnt(d.snapshot_at)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Kho', value: `${d.warehouse.code} – ${d.warehouse.name}` }, { label: 'Phạm vi', value: d.scope_type }, { label: 'Phiếu điều chỉnh', value: d.adjustment?.code ?? 'Không có' }],
        columns: [
          { key: 'stt', header: 'STT', type: 'number' }, { key: 'location', header: 'Vị trí' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư' }, { key: 'unit', header: 'ĐVT' },
          { key: 'book', header: 'Tồn sổ', type: 'number', total: true }, { key: 'counted', header: 'Thực tế', type: 'number', total: true }, { key: 'variance', header: 'Chênh lệch', type: 'number', total: true },
          { key: 'reason', header: 'Giải trình nguyên nhân' },
        ],
        rows: d.lines.map((l, i) => ({ stt: i + 1, location: l.location.code, code: l.item.code, name: l.item.name, unit: l.item.unit.code, book: n(l.book_qty), counted: n(l.counted_qty), variance: l.counted_qty != null ? Number(l.counted_qty.minus(l.book_qty)) : null, reason: l.reason ?? '' })),
        signatures: ['Người kiểm đếm', 'Thủ kho', 'Kế toán', 'Quản lý kho'], landscape: true,
      };
    }
    case 'transfer': {
      if (!can(req, 'transfers.view')) throw forbidden();
      const d = await prisma.stockTransfer.findUnique({ where: { id }, include: { from_warehouse: true, to_warehouse: true, creator: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, from_location: true, to_location: true } } } });
      if (!d) throw notFound();
      return {
        title: 'PHIẾU ĐIỀU CHUYỂN KHO', subtitle: `Số: ${d.code} – Ngày: ${vn(d.doc_date)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Từ kho', value: d.from_warehouse.name }, { label: 'Đến kho', value: d.to_warehouse.name }, { label: 'Người giao / nhận', value: `${d.sender_name ?? ''} / ${d.receiver_name ?? ''}` }, { label: 'Thời gian bàn giao', value: vnt(d.handover_at) }, { label: 'Lý do', value: d.reason ?? '' }],
        columns: [{ key: 'stt', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư' }, { key: 'unit', header: 'ĐVT' }, { key: 'from', header: 'Vị trí đi' }, { key: 'to', header: 'Vị trí đến' }, { key: 'qty', header: 'Số lượng', type: 'number', total: true }],
        rows: d.lines.map((l) => ({ stt: l.line_no, code: l.item.code, name: l.item.name, unit: l.item.unit.code, from: l.from_location.code, to: l.to_location.code, qty: n(l.qty) })),
        signatures: ['Người lập', 'Người giao', 'Người nhận', 'Quản lý kho'],
      };
    }
    case 'return': {
      if (!can(req, 'returns.view')) throw forbidden();
      const d = await prisma.stockReturn.findUnique({ where: { id }, include: { department: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      return {
        title: 'PHIẾU NHẬP HÀNG TRẢ LẠI', subtitle: `Số: ${d.code} – Ngày: ${vn(d.doc_date)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Bộ phận trả', value: d.department.name }, { label: 'Người trả', value: d.returned_by_name ?? '' }, { label: 'Lý do', value: d.reason ?? '' }],
        columns: [{ key: 'stt', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư' }, { key: 'unit', header: 'ĐVT' }, { key: 'loc', header: 'Vị trí' }, { key: 'qty', header: 'SL trả', type: 'number', total: true }, { key: 'usable', header: 'Dùng được', type: 'number', total: true }, { key: 'damaged', header: 'Hư hỏng', type: 'number', total: true }, { key: 'pending', header: 'Chờ xử lý', type: 'number', total: true }, { key: 'note', header: 'Nhận xét' }],
        rows: d.lines.map((l) => ({ stt: l.line_no, code: l.item.code, name: l.item.name, unit: l.item.unit.code, loc: l.location.code, qty: n(l.qty_returned), usable: n(l.qty_usable), damaged: n(l.qty_damaged), pending: n(l.qty_pending), note: l.inspection_note ?? '' })),
        signatures: ['Người trả', 'Người kiểm tra', 'Thủ kho', 'Quản lý kho'], landscape: true,
      };
    }
    case 'adjustment': {
      if (!can(req, 'adjustments.view')) throw forbidden();
      const d = await prisma.stockAdjustment.findUnique({ where: { id }, include: { warehouse: true, creator: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      return {
        title: 'PHIẾU ĐIỀU CHỈNH TỒN KHO', subtitle: `Số: ${d.code} – Ngày: ${vn(d.doc_date)} – Trạng thái: ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Kho', value: d.warehouse.name }, { label: 'Nguồn', value: d.source }, { label: 'Lý do', value: d.reason }],
        columns: [{ key: 'stt', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã VT' }, { key: 'name', header: 'Tên vật tư' }, { key: 'unit', header: 'ĐVT' }, { key: 'loc', header: 'Vị trí' }, { key: 'bucket', header: 'Loại tồn' }, { key: 'delta', header: 'SL điều chỉnh (+/-)', type: 'number', total: true }, { key: 'reason', header: 'Lý do' }],
        rows: d.lines.map((l) => ({ stt: l.line_no, code: l.item.code, name: l.item.name, unit: l.item.unit.code, loc: l.location.code, bucket: l.bucket, delta: n(l.qty_delta), reason: l.reason ?? '' })),
        signatures: ['Người lập', 'Kế toán', 'Người phê duyệt'],
      };
    }
  }
  throw notFound('Loại biểu mẫu không hợp lệ');
}

r.get('/:type/:id', requirePerm('receipts.view', 'issues.view', 'issues.view_all', 'stocktakes.view', 'transfers.view', 'returns.view', 'adjustments.view'), async (req, res) => {
  const result = await build(String(req.params.type), Number(req.params.id), req);
  const company = String((await getSettings())['company.name'] || 'SAMBO GOLD');
  await audit(req, 'PRINT', String(req.params.type), { id: Number(req.params.id) });
  sendFile(res, await toPdf(result, company), `${req.params.type}_${req.params.id}.pdf`, 'application/pdf', true);
});

export default r;
