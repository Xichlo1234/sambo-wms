/**
 * IMPORT DỮ LIỆU BAN ĐẦU TỪ EXCEL (XIV)
 * Quy trình: Tải file mẫu → Điền dữ liệu → Xem trước & kiểm tra (không ghi DB) → Xác nhận nhập.
 * Nguyên tắc: KHÔNG ghi đè dữ liệu hiện có (dòng trùng mã bị bỏ qua), báo cáo dòng lỗi, chống trùng trong file.
 * Tồn đầu kỳ: tạo PHIẾU ĐIỀU CHỈNH nguồn OPENING ở trạng thái Chờ duyệt – chỉ ghi sổ khi người khác phê duyệt.
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, can } from '../lib/auth';
import { audit } from '../lib/audit';
import { badRequest, forbidden } from '../lib/errors';
import { ok } from '../lib/http';
import { normalizeText } from '../lib/text';
import { sendFile } from '../lib/report';
import { findSimilarItems } from './items';
import { createAdjustment } from './adjustments';
import { notifyPermission } from '../lib/notify';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

type ColDef = { key: string; header: string; required?: boolean; note?: string; example?: string | number };
const TEMPLATES: Record<string, { title: string; perm: string; cols: ColDef[] }> = {
  items: {
    title: 'Danh mục vật tư / thiết bị', perm: 'items.import',
    cols: [
      { key: 'code', header: 'Mã vật tư', required: true, example: 'VT-BL-0001', note: 'Duy nhất, không trùng' },
      { key: 'name', header: 'Tên vật tư', required: true, example: 'Bulong lục giác M16x60' },
      { key: 'name_en', header: 'Tên tiếng Anh', example: 'Hex bolt M16x60' },
      { key: 'kind', header: 'Loại (VT/TB)', example: 'VT', note: 'VT = vật tư, TB = thiết bị' },
      { key: 'category', header: 'Mã nhóm', required: true, example: 'CK', note: 'Theo sheet Nhóm vật tư' },
      { key: 'subcategory', header: 'Mã phân nhóm', example: '' },
      { key: 'specification', header: 'Quy cách kỹ thuật', example: 'Thép 8.8, mạ kẽm' },
      { key: 'model', header: 'Model' }, { key: 'manufacturer', header: 'Hãng sản xuất' }, { key: 'origin', header: 'Xuất xứ', example: 'Việt Nam' },
      { key: 'unit', header: 'Đơn vị tính', required: true, example: 'CAI', note: 'Mã ĐVT theo sheet Đơn vị tính' },
      { key: 'barcode', header: 'Mã vạch / QR' }, { key: 'location', header: 'Mã vị trí mặc định', example: 'A-01-01' },
      { key: 'min_stock', header: 'Tồn tối thiểu', example: 50 }, { key: 'max_stock', header: 'Tồn tối đa', example: 500 },
      { key: 'safety_stock', header: 'Tồn an toàn', example: 80 }, { key: 'max_issue_qty', header: 'Định mức xuất/phiếu' },
      { key: 'supplier', header: 'Mã NCC ưu tiên' }, { key: 'serial_no', header: 'Số serial (thiết bị)' }, { key: 'asset_code', header: 'Mã tài sản (thiết bị)' },
      { key: 'note', header: 'Ghi chú' },
    ],
  },
  opening_stock: {
    title: 'Tồn kho ban đầu', perm: 'adjustments.create',
    cols: [
      { key: 'item', header: 'Mã vật tư', required: true, example: 'VT-BL-0001' },
      { key: 'location', header: 'Mã vị trí', required: true, example: 'A-01-01' },
      { key: 'qty', header: 'Số lượng tồn', required: true, example: 120 },
      { key: 'unit_price', header: 'Đơn giá (nếu có)', example: '' },
      { key: 'note', header: 'Ghi chú' },
    ],
  },
  suppliers: {
    title: 'Nhà cung cấp', perm: 'suppliers.manage',
    cols: [
      { key: 'code', header: 'Mã NCC', required: true, example: 'NCC001' }, { key: 'name', header: 'Tên doanh nghiệp', required: true, example: 'Công ty TNHH ABC' },
      { key: 'address', header: 'Địa chỉ' }, { key: 'country', header: 'Quốc gia', example: 'Việt Nam' }, { key: 'contact_person', header: 'Người liên hệ' },
      { key: 'phone', header: 'Điện thoại' }, { key: 'email', header: 'Email' }, { key: 'tax_code', header: 'Mã số thuế' },
      { key: 'supply_groups', header: 'Nhóm hàng cung cấp' }, { key: 'payment_terms', header: 'Điều khoản thanh toán' }, { key: 'note', header: 'Ghi chú' },
    ],
  },
  departments: {
    title: 'Bộ phận sử dụng', perm: 'departments.manage',
    cols: [
      { key: 'code', header: 'Mã bộ phận', required: true, example: 'MINING' }, { key: 'name', header: 'Tên bộ phận', required: true, example: 'Khai thác mỏ' },
      { key: 'manager_name', header: 'Người phụ trách' }, { key: 'area', header: 'Khu vực hoạt động' }, { key: 'description', header: 'Mô tả' },
    ],
  },
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
}

async function readSheet(buf: Buffer, cols: ColDef[]) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw badRequest('Không đọc được file. Vui lòng dùng file .xlsx theo mẫu.');
  }
  const ws = wb.getWorksheet('Dữ liệu') ?? wb.worksheets[0];
  if (!ws) throw badRequest('File không có sheet dữ liệu');
  // Tìm dòng tiêu đề (trong 5 dòng đầu) theo tên cột bắt buộc đầu tiên
  const firstReq = normalizeText(cols.find((c) => c.required)!.header);
  let headerRow = 0;
  for (let i = 1; i <= 5; i++) {
    const vals = (ws.getRow(i).values as ExcelJS.CellValue[]).map((v) => normalizeText(cellText(v).replace(/\*/g, '')));
    if (vals.includes(firstReq)) { headerRow = i; break; }
  }
  if (!headerRow) throw badRequest(`Không tìm thấy dòng tiêu đề (cột "${cols.find((c) => c.required)!.header}"). Vui lòng dùng file mẫu.`);
  const map = new Map<string, number>();
  ws.getRow(headerRow).eachCell((cell, colNo) => {
    const h = normalizeText(cellText(cell.value).replace(/\*/g, ''));
    const def = cols.find((c) => normalizeText(c.header) === h);
    if (def) map.set(def.key, colNo);
  });
  const missing = cols.filter((c) => c.required && !map.has(c.key));
  if (missing.length) throw badRequest(`Thiếu cột bắt buộc: ${missing.map((m) => m.header).join(', ')}`);
  const rows: { row: number; data: Record<string, string> }[] = [];
  for (let i = headerRow + 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const data: Record<string, string> = {};
    let any = false;
    for (const [k, c] of map) {
      data[k] = cellText(row.getCell(c).value);
      if (data[k]) any = true;
    }
    if (any) rows.push({ row: i, data });
  }
  if (rows.length > 5000) throw badRequest('Mỗi lần import tối đa 5.000 dòng. Vui lòng chia nhỏ file.');
  return rows;
}

type RowResult = { row: number; data: Record<string, string>; status: 'NEW' | 'DUPLICATE' | 'ERROR'; errors: string[]; warnings: string[]; parsed?: Record<string, unknown> };

const num = (s: string, field: string, errs: string[], opts: { required?: boolean; positive?: boolean } = {}) => {
  if (!s) { if (opts.required) errs.push(`${field}: bắt buộc`); return null; }
  const n = Number(s.replace(/\s/g, '').replace(/,/g, '.'));
  if (isNaN(n)) { errs.push(`${field}: "${s}" không phải số`); return null; }
  if (n < 0 || (opts.positive && n === 0)) { errs.push(`${field}: phải ${opts.positive ? '> 0' : '≥ 0'}`); return null; }
  return n;
};

interface Ctx { warehouse_id?: number; auto_create_refs?: boolean }

async function validateRows(type: string, rows: { row: number; data: Record<string, string> }[], ctx: Ctx, req: Request): Promise<RowResult[]> {
  const out: RowResult[] = [];
  const seen = new Set<string>();
  if (type === 'items') {
    const [cats, units, locs, sups, existing] = await Promise.all([
      prisma.itemCategory.findMany(), prisma.unit.findMany(), prisma.warehouseLocation.findMany(), prisma.supplier.findMany({ select: { id: true, code: true } }),
      prisma.item.findMany({ select: { code: true, barcode: true } }),
    ]);
    const exCodes = new Set(existing.map((e) => e.code));
    const exBarcodes = new Set(existing.map((e) => e.barcode).filter(Boolean));
    for (const { row, data } of rows) {
      const errors: string[] = []; const warnings: string[] = [];
      const code = data.code?.toUpperCase();
      if (!code) errors.push('Mã vật tư: bắt buộc');
      if (!data.name) errors.push('Tên vật tư: bắt buộc');
      if (code && seen.has(code)) errors.push(`Mã ${code} bị lặp trong file`);
      if (code) seen.add(code);
      const cat = cats.find((c) => c.code.toUpperCase() === data.category?.toUpperCase());
      if (!data.category) errors.push('Mã nhóm: bắt buộc');
      else if (!cat && !ctx.auto_create_refs) errors.push(`Mã nhóm "${data.category}" chưa có trong hệ thống`);
      else if (!cat) warnings.push(`Sẽ tạo mới nhóm "${data.category}"`);
      const sub = data.subcategory ? cats.find((c) => c.code.toUpperCase() === data.subcategory.toUpperCase()) : null;
      if (data.subcategory && !sub) errors.push(`Mã phân nhóm "${data.subcategory}" chưa có`);
      if (sub && cat && sub.parent_id !== cat.id) errors.push('Phân nhóm không thuộc nhóm đã chọn');
      const unit = units.find((u) => normalizeText(u.code) === normalizeText(data.unit) || normalizeText(u.name) === normalizeText(data.unit));
      if (!data.unit) errors.push('Đơn vị tính: bắt buộc');
      else if (!unit && !ctx.auto_create_refs) errors.push(`Đơn vị tính "${data.unit}" chưa có trong hệ thống`);
      else if (!unit) warnings.push(`Sẽ tạo mới ĐVT "${data.unit}"`);
      const loc = data.location ? locs.find((l) => l.code.toUpperCase() === data.location.toUpperCase()) : null;
      if (data.location && !loc) errors.push(`Mã vị trí "${data.location}" chưa có`);
      const sup = data.supplier ? sups.find((s) => s.code.toUpperCase() === data.supplier.toUpperCase()) : null;
      if (data.supplier && !sup) errors.push(`Mã NCC "${data.supplier}" chưa có`);
      if (data.barcode && exBarcodes.has(data.barcode)) errors.push(`Mã vạch ${data.barcode} đã được dùng`);
      const kindRaw = normalizeText(data.kind || 'vt');
      const kind = ['tb', 'thiet bi', 'equipment'].includes(kindRaw) ? 'EQUIPMENT' : 'MATERIAL';
      const min = num(data.min_stock, 'Tồn tối thiểu', errors) ?? 0;
      const max = num(data.max_stock, 'Tồn tối đa', errors);
      const safety = num(data.safety_stock, 'Tồn an toàn', errors) ?? 0;
      const maxIssue = num(data.max_issue_qty, 'Định mức xuất', errors);
      if (max != null && max < min) errors.push('Tồn tối đa phải ≥ tồn tối thiểu');
      let status: RowResult['status'] = errors.length ? 'ERROR' : 'NEW';
      if (!errors.length && code && exCodes.has(code)) { status = 'DUPLICATE'; warnings.push('Mã đã tồn tại – bỏ qua, không ghi đè'); }
      if (status === 'NEW') {
        const sim = await findSimilarItems(data.name, data.specification);
        if (sim.length) warnings.push(`Tương tự mặt hàng đã có: ${sim.slice(0, 3).map((s) => s.code + ' – ' + s.name).join('; ')}`);
      }
      out.push({ row, data, status, errors, warnings, parsed: {
        code, name: data.name, name_en: data.name_en || null, kind, category_code: data.category, category_id: cat?.id, subcategory_id: sub?.id ?? null,
        specification: data.specification || null, model: data.model || null, manufacturer: data.manufacturer || null, origin: data.origin || null,
        unit_code: data.unit, unit_id: unit?.id, barcode: data.barcode || null, default_location_id: loc?.id ?? null, min_stock: min, max_stock: max,
        safety_stock: safety, max_issue_qty: maxIssue, preferred_supplier_id: sup?.id ?? null, serial_no: data.serial_no || null, asset_code: data.asset_code || null, note: data.note || null,
      } });
    }
  } else if (type === 'opening_stock') {
    if (!ctx.warehouse_id) throw badRequest('Chọn kho nhập tồn đầu kỳ');
    const [items, locs, moved] = await Promise.all([
      prisma.item.findMany({ select: { id: true, code: true, status: true } }),
      prisma.warehouseLocation.findMany({ where: { warehouse_id: ctx.warehouse_id } }),
      prisma.stockMovement.groupBy({ by: ['item_id'], where: { warehouse_id: ctx.warehouse_id } }),
    ]);
    const pendingOpening = await prisma.stockAdjustmentItem.findMany({ where: { adjustment: { source: 'OPENING', warehouse_id: ctx.warehouse_id, status: { in: ['DRAFT', 'SUBMITTED'] } } }, select: { item_id: true } });
    const movedSet = new Set(moved.map((m) => m.item_id));
    const pendingSet = new Set(pendingOpening.map((m) => m.item_id));
    for (const { row, data } of rows) {
      const errors: string[] = []; const warnings: string[] = [];
      const it = items.find((i) => i.code.toUpperCase() === data.item?.toUpperCase());
      if (!data.item) errors.push('Mã vật tư: bắt buộc'); else if (!it) errors.push(`Mã vật tư "${data.item}" chưa có trong danh mục`);
      const loc = locs.find((l) => l.code.toUpperCase() === data.location?.toUpperCase());
      if (!data.location) errors.push('Mã vị trí: bắt buộc'); else if (!loc) errors.push(`Vị trí "${data.location}" không thuộc kho đã chọn`);
      const qty = num(data.qty, 'Số lượng', errors, { required: true, positive: true });
      const price = num(data.unit_price, 'Đơn giá', errors);
      const key = `${data.item?.toUpperCase()}|${data.location?.toUpperCase()}`;
      if (seen.has(key)) errors.push('Dòng trùng vật tư + vị trí trong file');
      seen.add(key);
      let status: RowResult['status'] = errors.length ? 'ERROR' : 'NEW';
      if (!errors.length && it && movedSet.has(it.id)) { status = 'DUPLICATE'; warnings.push('Vật tư đã có giao dịch/tồn trong kho – không nhập tồn đầu kỳ lần 2 (dùng phiếu điều chỉnh nếu cần)'); }
      if (!errors.length && it && pendingSet.has(it.id)) { status = 'DUPLICATE'; warnings.push('Vật tư đang có phiếu tồn đầu kỳ chờ duyệt'); }
      out.push({ row, data, status, errors, warnings, parsed: { item_id: it?.id, location_id: loc?.id, qty, unit_price: price, note: data.note || null } });
    }
  } else if (type === 'suppliers' || type === 'departments') {
    const existing = type === 'suppliers' ? await prisma.supplier.findMany({ select: { code: true, name: true, tax_code: true } }) : await prisma.department.findMany({ select: { code: true, name: true } });
    const exCodes = new Set(existing.map((e) => e.code.toUpperCase()));
    for (const { row, data } of rows) {
      const errors: string[] = []; const warnings: string[] = [];
      const code = data.code?.toUpperCase();
      if (!code) errors.push('Mã: bắt buộc');
      if (!data.name) errors.push('Tên: bắt buộc');
      if (code && seen.has(code)) errors.push(`Mã ${code} bị lặp trong file`);
      if (code) seen.add(code);
      if (type === 'suppliers' && data.email && !z.string().email().safeParse(data.email).success) errors.push('Email không hợp lệ');
      if (type === 'suppliers' && data.tax_code && (existing as unknown as { tax_code: string | null }[]).some((e) => e.tax_code === data.tax_code)) warnings.push(`MST ${data.tax_code} đã có ở NCC khác`);
      let status: RowResult['status'] = errors.length ? 'ERROR' : 'NEW';
      if (!errors.length && exCodes.has(code)) { status = 'DUPLICATE'; warnings.push('Mã đã tồn tại – bỏ qua, không ghi đè'); }
      out.push({ row, data, status, errors, warnings, parsed: { ...data, code } });
    }
  }
  void req;
  return out;
}

function ctxFrom(req: Request): Ctx {
  return { warehouse_id: req.body?.warehouse_id ? Number(req.body.warehouse_id) : undefined, auto_create_refs: req.body?.auto_create_refs === 'true' || req.body?.auto_create_refs === '1' };
}

function getTemplate(req: Request) {
  const t = TEMPLATES[String(req.params.type)];
  if (!t) throw badRequest('Loại import không hợp lệ');
  if (!can(req, t.perm) && !can(req, 'import.run')) throw forbidden(`Cần quyền ${t.perm} để import ${t.title}`);
  return t;
}

// ---------- File mẫu ----------
r.get('/templates/:type', async (req, res) => {
  const t = getTemplate(req);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dữ liệu');
  ws.addRow(t.cols.map((c) => c.header + (c.required ? ' *' : '')));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  ws.getRow(1).height = 32;
  ws.addRow(t.cols.map((c) => c.example ?? ''));
  ws.getRow(2).font = { italic: true, color: { argb: 'FF888888' } };
  t.cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(14, c.header.length + 4); });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const guide = wb.addWorksheet('Hướng dẫn');
  guide.addRow([`HƯỚNG DẪN IMPORT: ${t.title.toUpperCase()}`]).font = { bold: true, size: 13 };
  guide.addRow(['1. Điền dữ liệu từ dòng 2 sheet "Dữ liệu" (xóa dòng ví dụ màu xám trước khi import). Cột có dấu * là bắt buộc.']);
  guide.addRow(['2. Không đổi tên cột. Có thể đổi thứ tự cột.']);
  guide.addRow(['3. Dòng có mã đã tồn tại sẽ được BỎ QUA (hệ thống không ghi đè dữ liệu hiện có).']);
  guide.addRow(['4. Luôn bấm "Kiểm tra & xem trước" để xem lỗi trước khi xác nhận nhập.']);
  if (req.params.type === 'opening_stock') guide.addRow(['5. Tồn đầu kỳ được tạo thành phiếu điều chỉnh "Chờ duyệt" – chỉ cập nhật tồn kho khi Quản lý kho (người khác) phê duyệt.']);
  guide.addRow([]);
  guide.addRow(['Cột', 'Bắt buộc', 'Ghi chú']).font = { bold: true };
  t.cols.forEach((c) => guide.addRow([c.header, c.required ? 'Có' : '', c.note ?? '']));
  guide.getColumn(1).width = 30; guide.getColumn(2).width = 10; guide.getColumn(3).width = 60;
  if (req.params.type === 'items' || req.params.type === 'opening_stock') {
    const [cats, units, locs] = await Promise.all([
      prisma.itemCategory.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' }, include: { parent: true } }),
      prisma.unit.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } }),
      prisma.warehouseLocation.findMany({ where: { status: 'ACTIVE' }, include: { warehouse: true }, orderBy: [{ warehouse_id: 'asc' }, { code: 'asc' }] }),
    ]);
    const s1 = wb.addWorksheet('Nhóm vật tư'); s1.addRow(['Mã nhóm', 'Tên nhóm', 'Thuộc nhóm']).font = { bold: true };
    cats.forEach((c) => s1.addRow([c.code, c.name, c.parent?.code ?? '']));
    const s2 = wb.addWorksheet('Đơn vị tính'); s2.addRow(['Mã ĐVT', 'Tên']).font = { bold: true };
    units.forEach((u) => s2.addRow([u.code, u.name]));
    const s3 = wb.addWorksheet('Vị trí kho'); s3.addRow(['Kho', 'Mã vị trí', 'Tên vị trí']).font = { bold: true };
    locs.forEach((l) => s3.addRow([l.warehouse.code, l.code, l.name]));
    [s1, s2, s3].forEach((s) => { s.getColumn(1).width = 16; s.getColumn(2).width = 30; s.getColumn(3).width = 20; });
  }
  sendFile(res, Buffer.from(await wb.xlsx.writeBuffer()), `Mau_import_${req.params.type}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

// ---------- Xem trước ----------
r.post('/:type/preview', upload.single('file'), async (req, res) => {
  const t = getTemplate(req);
  if (!req.file) throw badRequest('Chưa chọn file Excel');
  const rows = await readSheet(req.file.buffer, t.cols);
  const result = await validateRows(String(req.params.type), rows, ctxFrom(req), req);
  ok(res, {
    summary: { total: result.length, new: result.filter((x) => x.status === 'NEW').length, duplicate: result.filter((x) => x.status === 'DUPLICATE').length, error: result.filter((x) => x.status === 'ERROR').length },
    rows: result.map(({ parsed: _p, ...x }) => x),
  });
});

// ---------- Báo cáo dòng lỗi ----------
r.post('/:type/error-report', upload.single('file'), async (req, res) => {
  const t = getTemplate(req);
  if (!req.file) throw badRequest('Chưa chọn file Excel');
  const result = await validateRows(String(req.params.type), await readSheet(req.file.buffer, t.cols), ctxFrom(req), req);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kết quả kiểm tra');
  ws.addRow(['Dòng', 'Trạng thái', 'Lỗi', 'Cảnh báo', ...t.cols.map((c) => c.header)]).font = { bold: true };
  for (const x of result.filter((r) => r.status !== 'NEW' || r.warnings.length)) {
    ws.addRow([x.row, x.status === 'ERROR' ? 'LỖI' : x.status === 'DUPLICATE' ? 'TRÙNG - BỎ QUA' : 'CẢNH BÁO', x.errors.join('; '), x.warnings.join('; '), ...t.cols.map((c) => x.data[c.key] ?? '')]);
  }
  ws.getColumn(3).width = 50; ws.getColumn(4).width = 50;
  sendFile(res, Buffer.from(await wb.xlsx.writeBuffer()), `Ket_qua_kiem_tra_${req.params.type}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

// ---------- Xác nhận nhập ----------
r.post('/:type/commit', upload.single('file'), async (req, res) => {
  const t = getTemplate(req);
  const type = String(req.params.type);
  if (!req.file) throw badRequest('Chưa chọn file Excel');
  const ctx = ctxFrom(req);
  const result = await validateRows(type, await readSheet(req.file.buffer, t.cols), ctx, req);
  const errorsCount = result.filter((x) => x.status === 'ERROR').length;
  if (errorsCount && req.body?.skip_errors !== 'true') {
    throw badRequest(`File còn ${errorsCount} dòng lỗi. Sửa lỗi rồi import lại, hoặc chọn "Bỏ qua dòng lỗi" để chỉ nhập các dòng hợp lệ.`);
  }
  const good = result.filter((x) => x.status === 'NEW');
  if (!good.length) throw badRequest('Không có dòng hợp lệ mới để nhập');
  const uid = req.user!.id;
  let refDoc: string | null = null;
  await withTx(async (tx) => {
    if (type === 'items') {
      const catCache = new Map<string, number>();
      const unitCache = new Map<string, number>();
      for (const x of good) {
        const p = x.parsed as Record<string, unknown>;
        let categoryId = p.category_id as number | undefined;
        if (!categoryId) {
          const k = String(p.category_code).toUpperCase();
          categoryId = catCache.get(k) ?? (await tx.itemCategory.upsert({ where: { code: k }, create: { code: k, name: k, created_by: uid }, update: {} })).id;
          catCache.set(k, categoryId);
        }
        let unitId = p.unit_id as number | undefined;
        if (!unitId) {
          const k = String(p.unit_code).toUpperCase().slice(0, 20);
          unitId = unitCache.get(k) ?? (await tx.unit.upsert({ where: { code: k }, create: { code: k, name: String(p.unit_code), created_by: uid }, update: {} })).id;
          unitCache.set(k, unitId);
        }
        const { category_code: _a, unit_code: _b, category_id: _c, unit_id: _d, ...rest } = p;
        await tx.item.create({ data: { ...(rest as object), code: String(p.code), name: String(p.name), category_id: categoryId, unit_id: unitId, search_text: normalizeText(String(p.name), p.specification as string, p.name_en as string, p.model as string), created_by: uid, updated_by: uid } as never });
      }
    } else if (type === 'opening_stock') {
      const docDate = req.body?.doc_date ? new Date(String(req.body.doc_date)) : new Date();
      const adj = await createAdjustment(tx, uid, {
        warehouse_id: ctx.warehouse_id!, doc_date: docDate, reason: `Nhập tồn kho ban đầu từ Excel (${req.file!.originalname})`, source: 'OPENING', status: 'SUBMITTED',
      }, good.map((x) => {
        const p = x.parsed as { item_id: number; location_id: number; qty: number; unit_price: number | null; note: string | null };
        return { item_id: p.item_id, location_id: p.location_id, bucket: 'USABLE' as const, qty_delta: p.qty, unit_price: p.unit_price, reason: p.note };
      }));
      refDoc = adj.code;
      await notifyPermission(tx, ['adjustments.approve'], uid, { type: 'APPROVAL', title: `Tồn đầu kỳ ${adj.code} (${good.length} dòng) chờ duyệt`, link: `/adjustments/${adj.id}` });
    } else if (type === 'suppliers') {
      for (const x of good) {
        const d = x.data;
        await tx.supplier.create({ data: { code: String(x.parsed!.code), name: d.name, address: d.address || null, country: d.country || null, contact_person: d.contact_person || null, phone: d.phone || null, email: d.email || null, tax_code: d.tax_code || null, supply_groups: d.supply_groups || null, payment_terms: d.payment_terms || null, note: d.note || null, search_text: normalizeText(d.name, String(x.parsed!.code)), created_by: uid, updated_by: uid } });
      }
    } else if (type === 'departments') {
      for (const x of good) {
        const d = x.data;
        await tx.department.create({ data: { code: String(x.parsed!.code), name: d.name, manager_name: d.manager_name || null, area: d.area || null, description: d.description || null, created_by: uid, updated_by: uid } });
      }
    }
    await tx.importBatch.create({
      data: {
        import_type: type, file_name: req.file!.originalname.slice(0, 255), total_rows: result.length, success_rows: good.length, error_rows: errorsCount,
        skipped_rows: result.filter((x) => x.status === 'DUPLICATE').length, status: 'SUCCESS', ref_doc: refDoc, created_by: uid,
        summary: { errors: result.filter((x) => x.status === 'ERROR').slice(0, 200).map((x) => ({ row: x.row, errors: x.errors })) },
      },
    });
  }, );
  await audit(req, 'IMPORT', 'import', { code: type }, undefined, { file: req.file.originalname, inserted: good.length, ref_doc: refDoc });
  ok(res, { inserted: good.length, skipped: result.length - good.length, ref_doc: refDoc });
});

r.get('/history', async (req, res) => {
  const rows = await prisma.importBatch.findMany({ orderBy: { id: 'desc' }, take: 50 });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.created_by) } }, select: { id: true, full_name: true } });
  ok(res, rows.map((x) => ({ ...x, user: users.find((u) => u.id === x.created_by)?.full_name })));
});

export default r;

