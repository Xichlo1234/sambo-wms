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
    case 'chem-receipt': {
      if (!can(req, 'chemicals.view')) throw forbidden();
      const d = await prisma.chemicalReceipt.findUnique({ where: { id }, include: { warehouse: true, supplier: true, creator: true, purchase_order: true, batches: true, lines: { orderBy: { line_no: 'asc' }, include: { chemical: { include: { unit: true } }, location: true } } } });
      if (!d) throw notFound();
      const RES: Record<string, string> = { PASSED: 'Đạt', QUARANTINE: 'Cách ly', FAILED: 'Không đạt' };
      return {
        title: 'PHIẾU NHẬP KHO HÓA CHẤT', subtitle: `Số: ${d.code} – Ngày CT: ${vn(d.doc_date)} – Ngày nhận: ${vn(d.received_date)} – ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Kho', value: d.warehouse.name }, { label: 'Nhà cung cấp', value: d.supplier?.name ?? '' }, { label: 'Đơn đặt hàng', value: d.purchase_order?.code ?? '' }, { label: 'Số HĐ/phiếu giao', value: d.supplier_doc_no ?? '' },
          { label: 'Kiểm tra tiếp nhận', value: `Bao bì ${d.chk_packaging ? '✔' : '✘'} · Nhãn ${d.chk_label ? '✔' : '✘'} · Chứng từ ${d.chk_documents ? '✔' : '✘'} · SDS ${d.chk_sds ? '✔' : '✘'} · Vận chuyển ${d.chk_transport ? '✔' : '✘'}` }, { label: 'Điều kiện vận chuyển', value: d.transport_note ?? '' }],
        columns: [{ key: 'stt', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất' }, { key: 'batch', header: 'Mã lô NSX' }, { key: 'internal', header: 'Lô nội bộ' }, { key: 'mfg', header: 'NSX', type: 'date' }, { key: 'exp', header: 'HSD', type: 'date' }, { key: 'unit', header: 'ĐVT' }, { key: 'doc', header: 'SL CT', type: 'number', total: true }, { key: 'rec', header: 'SL nhận', type: 'number', total: true }, { key: 'loc', header: 'Vị trí' }, { key: 'res', header: 'Kết quả' }, { key: 'note', header: 'Tình trạng' }],
        rows: d.lines.map((l) => ({ stt: l.line_no, code: l.chemical.code, name: l.chemical.name, batch: l.batch_no, internal: d.batches.find((b) => b.receipt_line_id === l.id)?.internal_code ?? '', mfg: l.mfg_date, exp: l.expiry_date, unit: l.chemical.unit.code, doc: n(l.qty_doc), rec: n(l.qty_received), loc: l.location.code, res: RES[l.result], note: l.condition_note ?? '' })),
        signatures: ['Người giao hàng', 'Thủ kho hóa chất', 'HSE', 'Người phê duyệt'], landscape: true,
      };
    }
    case 'chem-issue': {
      if (!can(req, 'chemicals.view') && !can(req, 'chemicals.request')) throw forbidden();
      const d = await prisma.chemicalIssue.findUnique({ where: { id }, include: { department: true, requester: true, warehouse: true, lines: { orderBy: { line_no: 'asc' }, include: { chemical: { include: { unit: true } } } } } });
      if (!d) throw notFound();
      const rows: Record<string, unknown>[] = [];
      for (const l of d.lines) {
        const det = (l.batch_detail as { internal_code: string; batch_no: string; expiry_date: string; qty: number }[] | null) ?? [];
        if (!det.length) rows.push({ code: l.chemical.code, name: l.chemical.name, unit: l.chemical.unit.code, req: n(l.qty_requested), appr: n(l.qty_approved), qty: n(l.qty_issued), batch: '', exp: null, ppe: l.chemical.ppe_req ?? '' });
        det.forEach((b, i) => rows.push({ code: i ? '' : l.chemical.code, name: i ? '' : l.chemical.name, unit: l.chemical.unit.code, req: i ? null : n(l.qty_requested), appr: i ? null : n(l.qty_approved), qty: b.qty, batch: `${b.internal_code} / ${b.batch_no}`, exp: b.expiry_date, ppe: i ? '' : l.chemical.ppe_req ?? '' }));
      }
      return {
        title: 'PHIẾU XUẤT KHO HÓA CHẤT', subtitle: `Số: ${d.code} – Ngày: ${vn(d.doc_date)} – ${STATUS_LABEL[d.status]}`,
        summary: [{ label: 'Bộ phận sử dụng', value: d.department.name }, { label: 'Mục đích', value: d.purpose }, { label: 'Khu vực sử dụng', value: d.work_area }, { label: 'Người chịu trách nhiệm', value: d.responsible_person }, { label: 'Người yêu cầu', value: d.requester.full_name },
          { label: 'HSE xác nhận', value: d.requires_hse ? (d.hse_confirmed_at ? `Đã xác nhận ${vnt(d.hse_confirmed_at)} – ${d.hse_note ?? ''}` : 'CHƯA XÁC NHẬN') : 'Không yêu cầu' }, { label: 'Thời gian xuất', value: vnt(d.issued_at) }, { label: 'Người nhận', value: `${d.receiver_name ?? ''}${d.receive_signature ? ` (xác nhận điện tử “${d.receive_signature}” ${vnt(d.receive_confirmed_at)})` : ''}` }],
        columns: [{ key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất' }, { key: 'unit', header: 'ĐVT' }, { key: 'req', header: 'SL yêu cầu', type: 'number' }, { key: 'appr', header: 'SL duyệt', type: 'number' }, { key: 'batch', header: 'Lô (nội bộ / NSX)' }, { key: 'exp', header: 'HSD', type: 'date' }, { key: 'qty', header: 'SL xuất', type: 'number', total: true }, { key: 'ppe', header: 'Bảo hộ yêu cầu (theo SDS)' }],
        rows, signatures: ['Người yêu cầu', 'Người phê duyệt', 'Thủ kho xuất', 'Người nhận'], landscape: true,
      };
    }
    case 'chem-stocktake': {
      if (!can(req, 'chemicals.view')) throw forbidden();
      const st = await prisma.chemicalStocktake.findUnique({ where: { id }, include: { lines: true } });
      if (!st) throw notFound();
      const bs = await prisma.chemicalBatch.findMany({ where: { id: { in: st.lines.map((l) => l.batch_id) } }, include: { chemical: { include: { unit: true } }, location: true } });
      return {
        title: 'BIÊN BẢN KIỂM KÊ KHO HÓA CHẤT', subtitle: `Số: ${st.code} – ${st.name} – Chốt sổ: ${vnt(st.snapshot_at)} – ${STATUS_LABEL[st.status]}`,
        columns: [{ key: 'loc', header: 'Vị trí' }, { key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất' }, { key: 'lot', header: 'Lô' }, { key: 'exp', header: 'HSD', type: 'date' }, { key: 'unit', header: 'ĐVT' }, { key: 'book', header: 'Tồn sổ', type: 'number', total: true }, { key: 'counted', header: 'Thực tế', type: 'number', total: true }, { key: 'var', header: 'Chênh lệch', type: 'number', total: true }, { key: 'pack', header: 'Bao bì' }, { key: 'reason', header: 'Giải trình' }],
        rows: st.lines.map((l) => { const b = bs.find((x) => x.id === l.batch_id)!; return { loc: b.location.code, code: b.chemical.code, name: b.chemical.name, lot: `${b.internal_code} / ${b.batch_no}`, exp: b.expiry_date, unit: b.chemical.unit.code, book: n(l.book_qty), counted: n(l.counted_qty), var: l.counted_qty != null ? Number(l.counted_qty.minus(l.book_qty)) : null, pack: l.packaging_ok == null ? '' : l.packaging_ok ? 'Tốt' : `Bất thường: ${l.packaging_note ?? ''}`, reason: l.reason ?? '' }; }),
        signatures: ['Người kiểm đếm', 'Thủ kho hóa chất', 'HSE', 'Quản lý kho'], landscape: true,
      };
    }
    case 'chem-adjustment': {
      if (!can(req, 'chemicals.view')) throw forbidden();
      const a = await prisma.chemicalAdjustment.findUnique({ where: { id }, include: { lines: true } });
      if (!a) throw notFound();
      const bs = await prisma.chemicalBatch.findMany({ where: { id: { in: a.lines.map((l) => l.batch_id) } }, include: { chemical: { include: { unit: true } } } });
      return {
        title: a.adj_type === 'DISPOSAL' ? 'BIÊN BẢN TIÊU HỦY HÓA CHẤT' : 'PHIẾU ĐIỀU CHỈNH TỒN KHO HÓA CHẤT', subtitle: `Số: ${a.code} – Ngày: ${vn(a.doc_date)} – ${STATUS_LABEL[a.status]}`,
        summary: [{ label: 'Lý do', value: a.reason }, ...(a.disposal_method ? [{ label: 'Phương thức / đơn vị xử lý', value: a.disposal_method }] : [])],
        columns: [{ key: 'code', header: 'Mã HC' }, { key: 'name', header: 'Tên hóa chất' }, { key: 'lot', header: 'Lô' }, { key: 'exp', header: 'HSD', type: 'date' }, { key: 'unit', header: 'ĐVT' }, { key: 'qty', header: 'SL (+/-)', type: 'number', total: true }, { key: 'reason', header: 'Lý do dòng' }],
        rows: a.lines.map((l) => { const b = bs.find((x) => x.id === l.batch_id)!; return { code: b.chemical.code, name: b.chemical.name, lot: `${b.internal_code} / ${b.batch_no}`, exp: b.expiry_date, unit: b.chemical.unit.code, qty: n(l.qty_delta), reason: l.reason ?? '' }; }),
        signatures: ['Người lập', 'HSE', 'Người phê duyệt', 'Đơn vị xử lý'],
      };
    }
    case 'po': {
      if (!can(req, 'purchase.view')) throw forbidden();
      const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, lines: { orderBy: { line_no: 'asc' }, include: { item: { include: { unit: true } }, chemical: { include: { unit: true } } } } } });
      if (!po) throw notFound();
      const val = can(req, 'purchase.view_value');
      return {
        title: 'ĐƠN ĐẶT HÀNG (PURCHASE ORDER)', subtitle: `Số: ${po.code} – Ngày đặt: ${vn(po.order_date)} – Giao dự kiến: ${vn(po.expected_date)}`,
        summary: [{ label: 'Nhà cung cấp', value: `${po.supplier.code} – ${po.supplier.name}` }, { label: 'Địa chỉ', value: po.supplier.address ?? '' }, { label: 'Liên hệ', value: [po.supplier.contact_person, po.supplier.phone, po.supplier.email].filter(Boolean).join(' – ') }, { label: 'Tiền tệ', value: po.currency ?? '' }, { label: 'Điều khoản thanh toán', value: po.payment_terms ?? '' }, { label: 'Điều kiện giao hàng', value: po.delivery_terms ?? '' }],
        columns: [{ key: 'stt', header: 'STT', type: 'number' }, { key: 'code', header: 'Mã hàng' }, { key: 'name', header: 'Tên hàng hóa' }, { key: 'unit', header: 'ĐVT' }, { key: 'qty', header: 'Số lượng', type: 'number', total: true }, ...(val ? [{ key: 'price', header: 'Đơn giá', type: 'money' as const }, { key: 'amount', header: 'Thành tiền', type: 'money' as const, total: true }] : []), { key: 'note', header: 'Ghi chú' }],
        rows: po.lines.map((l) => ({ stt: l.line_no, code: l.item?.code ?? l.chemical?.code, name: l.item?.name ?? l.chemical?.name, unit: l.item?.unit.code ?? l.chemical?.unit.code, qty: n(l.qty_ordered), price: n(l.unit_price), amount: n(l.amount), note: l.note ?? '' })),
        signatures: ['Người lập', 'Người phê duyệt', 'Xác nhận của nhà cung cấp'],
      };
    }
  }
  throw notFound('Loại biểu mẫu không hợp lệ');
}

r.get('/:type/:id', requirePerm('receipts.view', 'issues.view', 'issues.view_all', 'stocktakes.view', 'transfers.view', 'returns.view', 'adjustments.view', 'chemicals.view', 'chemicals.request', 'purchase.view'), async (req, res) => {
  const result = await build(String(req.params.type), Number(req.params.id), req);
  const company = String((await getSettings())['company.name'] || 'SAMBO GOLD');
  await audit(req, 'PRINT', String(req.params.type), { id: Number(req.params.id) });
  sendFile(res, await toPdf(result, company), `${req.params.type}_${req.params.id}.pdf`, 'application/pdf', true);
});

export default r;
