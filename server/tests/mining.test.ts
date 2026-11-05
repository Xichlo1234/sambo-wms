/**
 * BỘ KIỂM THỬ NGHIỆP VỤ KHO MỎ – tương ứng các tình huống nghiệm thu mục XIX.
 * Chạy: npm test  (tự tạo DB sambo_wms_test sạch)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { login, today, type Client } from './helpers';
import { prisma } from '../src/db';

let officer: Client, officer2: Client, manager: Client, maint: Client, mining: Client, accountant: Client, admin: Client;
let wh: number, locA1: number, locA2: number, locRecv: number, deptMaint: number, deptMining: number, supplier: number;
const item: Record<string, number> = {};

async function stockOf(itemId: number) {
  const b = await prisma.inventoryBalance.aggregate({ where: { item_id: itemId, warehouse_id: wh }, _sum: { qty_usable: true, qty_quarantine: true, qty_damaged: true } });
  return { usable: Number(b._sum.qty_usable ?? 0), quarantine: Number(b._sum.qty_quarantine ?? 0), damaged: Number(b._sum.qty_damaged ?? 0) };
}

async function receive(lines: { item_id: number; qty: number; location_id?: number }[], by = officer, approver = manager) {
  const r = await by.post('/api/receipts').send({
    warehouse_id: wh, doc_date: today(), supplier_id: supplier, docs_checked: true, qty_checked: true, spec_checked: true,
    lines: lines.map((l) => ({ item_id: l.item_id, location_id: l.location_id ?? locA1, qty_doc: l.qty, qty_received: l.qty })),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await by.post(`/api/receipts/${r.body.data.id}/submit`)).status).toBe(200);
  const a = await approver.post(`/api/receipts/${r.body.data.id}/approve`).send({});
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return r.body.data.id as number;
}

async function requestIssue(by: Client, dept: number, lines: { item_id: number; qty: number }[]) {
  const r = await by.post('/api/issues').send({ warehouse_id: wh, doc_date: today(), department_id: dept, purpose: 'Bảo dưỡng định kỳ máy xúc', lines: lines.map((l) => ({ item_id: l.item_id, qty_requested: l.qty })) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await by.post(`/api/issues/${r.body.data.id}/submit`)).status).toBe(200);
  return r.body.data.id as number;
}

beforeAll(async () => {
  [officer, officer2, manager, maint, mining, accountant] = await Promise.all(['thukho', 'thukho2', 'quanlykho', 'baotri', 'khaithac', 'ketoan'].map((u) => login(u)));
  admin = await login('admin', 'Admin@2026');
  wh = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO-TONG' } })).id;
  const loc = async (c: string) => (await prisma.warehouseLocation.findFirstOrThrow({ where: { code: c } })).id;
  locA1 = await loc('A-01'); locA2 = await loc('A-02'); locRecv = await loc('NHAN-HANG');
  deptMaint = (await prisma.department.findUniqueOrThrow({ where: { code: 'MAINT' } })).id;
  deptMining = (await prisma.department.findUniqueOrThrow({ where: { code: 'MINING' } })).id;
  supplier = (await prisma.supplier.findUniqueOrThrow({ where: { code: 'NCC001' } })).id;
  for (const c of ['TH-0001', 'PT-0001', 'CK-0001', 'BH-0001', 'BH-0002', 'DI-0001']) item[c] = (await prisma.item.findUniqueOrThrow({ where: { code: c } })).id;
});

describe('1. Danh mục vật tư', () => {
  it('tạo mới vật tư, chặn trùng mã, cảnh báo tên tương tự', async () => {
    const cat = await prisma.itemCategory.findUniqueOrThrow({ where: { code: 'CK' } });
    const unit = await prisma.unit.findUniqueOrThrow({ where: { code: 'CAI' } });
    const base = { name: 'Đai ốc M16', category_id: cat.id, unit_id: unit.id, min_stock: 10, max_stock: 100 };
    const r1 = await officer.post('/api/items').send({ ...base, code: 'ck-9001' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.code).toBe('CK-9001');
    const dup = await officer.post('/api/items').send({ ...base, code: 'CK-9001', name: 'Khác hẳn' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
    const sim = await officer.post('/api/items').send({ ...base, code: 'CK-9002', name: 'Bulong luc giac M16x60', specification: 'Thép 8.8 mạ kẽm' });
    expect(sim.status).toBe(409);
    expect(sim.body.error.code).toBe('SIMILAR_ITEMS');
    expect(sim.body.error.details[0].code).toBe('CK-0001');
    const confirmed = await officer.post('/api/items').send({ ...base, code: 'CK-9002', name: 'Bulong luc giac M16x60', specification: 'Thép 8.8 mạ kẽm', confirm_similar: true });
    expect(confirmed.status).toBe(200);
    const bad = await officer.post('/api/items').send({ ...base, code: 'CK-9003', min_stock: 50, max_stock: 10 });
    expect(bad.status).toBe(400);
  });

  it('tìm kiếm không dấu', async () => {
    const r = await officer.get('/api/items?q=giay bao ho');
    expect(r.body.data.some((x: { code: string }) => x.code === 'BH-0001')).toBe(true);
  });
});

describe('2. Import danh mục từ Excel', () => {
  it('xem trước báo lỗi, nhập dòng hợp lệ, bỏ qua trùng – không ghi đè', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dữ liệu');
    ws.addRow(['Mã vật tư *', 'Tên vật tư *', 'Mã nhóm *', 'Đơn vị tính *', 'Tồn tối thiểu', 'Tồn tối đa']);
    ws.addRow(['IMP-001', 'Vòng bi 6205', 'CK', 'CAI', 5, 50]);
    ws.addRow(['IMP-002', 'Dây curoa B52', 'PT', 'Cái', 2, 20]);
    ws.addRow(['TH-0001', 'Que hàn đổi tên', 'TH', 'KG', 0, '']);
    ws.addRow(['IMP-003', 'Thiếu ĐVT', 'CK', '', 0, '']);
    ws.addRow(['IMP-001', 'Lặp mã trong file', 'CK', 'CAI', 0, '']);
    ws.addRow(['IMP-004', 'Sai số', 'CK', 'CAI', 'abc', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const pv = await officer.post('/api/import/items/preview').attach('file', buf, 'items.xlsx');
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(pv.body.data.summary).toEqual({ total: 6, new: 2, duplicate: 1, error: 3 });
    const blocked = await officer.post('/api/import/items/commit').attach('file', buf, 'items.xlsx');
    expect(blocked.status).toBe(400);
    const cm = await officer.post('/api/import/items/commit').field('skip_errors', 'true').attach('file', buf, 'items.xlsx');
    expect(cm.status, JSON.stringify(cm.body)).toBe(200);
    expect(cm.body.data.inserted).toBe(2);
    const th = await prisma.item.findUniqueOrThrow({ where: { code: 'TH-0001' } });
    expect(th.name).toBe('Que hàn KT-421 Ø3.2'); // không bị ghi đè
    const tpl = await officer.get('/api/import/templates/items');
    expect(tpl.headers['content-type']).toContain('spreadsheetml');
  });
});

describe('3-5. Nhập kho nhiều dòng, phê duyệt, tồn sau nhập', () => {
  it('không tăng tồn khi chưa duyệt; người lập không tự duyệt; duyệt xong tăng tồn đúng', async () => {
    const before = await stockOf(item['PT-0001']);
    const r = await officer.post('/api/receipts').send({
      warehouse_id: wh, doc_date: today(), supplier_id: supplier, po_number: 'PO-TEST-01',
      lines: [
        { item_id: item['PT-0001'], location_id: locA2, qty_doc: 20, qty_received: 18, unit_price: 350000, note: 'Thiếu 2 cái, NCC giao bù' },
        { item_id: item['CK-0001'], location_id: locA2, qty_doc: 500, qty_received: 500, qty_pending: 100, qty_rejected: 20, condition_note: '20 cái gỉ sét' },
        { item_id: item['BH-0001'], location_id: locA1, qty_doc: 30, qty_received: 30 },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const id = r.body.data.id;
    expect(r.body.data.code).toMatch(/^PN\d{4}-\d{5}$/);
    // Chưa đánh dấu 3 bước kiểm tra → không gửi duyệt được
    const s1 = await officer.post(`/api/receipts/${id}/submit`);
    expect(s1.status).toBe(422);
    const doc = (await officer.get(`/api/receipts/${id}`)).body.data;
    const upd = await officer.put(`/api/receipts/${id}`).send({
      warehouse_id: wh, doc_date: today(), supplier_id: supplier, po_number: 'PO-TEST-01', docs_checked: true, qty_checked: true, spec_checked: true,
      lines: doc.lines.map((l: Record<string, unknown>, i: number) => ({ unit_price: i === 0 ? 350000 : null, item_id: l.item_id, location_id: l.location_id, qty_doc: l.qty_doc, qty_received: l.qty_received, qty_pending: l.qty_pending, qty_rejected: l.qty_rejected, note: l.note, condition_note: l.condition_note })),
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect((await officer.post(`/api/receipts/${id}/submit`)).status).toBe(200);
    expect((await stockOf(item['PT-0001'])).usable).toBe(before.usable); // chưa duyệt – chưa tăng tồn
    expect((await officer.post(`/api/receipts/${id}/approve`).send({})).status).toBe(403); // không có quyền duyệt + tự duyệt
    const ap = await manager.post(`/api/receipts/${id}/approve`).send({ comment: 'OK' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect((await stockOf(item['PT-0001'])).usable).toBe(before.usable + 18);
    const ck = await stockOf(item['CK-0001']);
    expect(ck.usable).toBe(380);
    expect(ck.quarantine).toBe(100);
    // Duyệt lần 2 → xung đột trạng thái
    expect((await manager.post(`/api/receipts/${id}/approve`).send({})).status).toBe(409);
    // Xử lý hàng chờ kiểm tra: 90 đạt, 10 hỏng
    const line = (await officer.get(`/api/receipts/${id}`)).body.data.lines.find((l: { item_id: number }) => l.item_id === item['CK-0001']);
    const insp = await officer.post(`/api/receipts/${id}/lines/${line.id}/inspect`).send({ qty_release: 90, qty_reject: 10, note: 'Kiểm tra QC' });
    expect(insp.status, JSON.stringify(insp.body)).toBe(200);
    expect(await stockOf(item['CK-0001'])).toEqual({ usable: 470, quarantine: 0, damaged: 10 });
  });

  it('kế toán không được xem đơn giá khi không có quyền? – kế toán CÓ quyền xem giá trị, thủ kho thì không', async () => {
    const list = (await officer.get('/api/receipts?q=PO-TEST-01')).body.data;
    const asOfficer = (await officer.get(`/api/receipts/${list[0].id}`)).body.data;
    expect(asOfficer.lines[0].unit_price).toBeNull();
    const asAcc = (await accountant.get(`/api/receipts/${list[0].id}`)).body.data;
    expect(asAcc.lines[0].unit_price).toBe(350000);
  });
});

describe('6-9. Xuất kho', () => {
  it('bộ phận chỉ lập yêu cầu cho bộ phận mình; vượt tồn bị chặn; duyệt – xuất – xác nhận', async () => {
    await receive([{ item_id: item['BH-0002'], qty: 50 }]);
    const other = await maint.post('/api/issues').send({ warehouse_id: wh, doc_date: today(), department_id: deptMining, purpose: 'Thử', lines: [{ item_id: item['BH-0002'], qty_requested: 1 }] });
    expect(other.status).toBe(403);
    const id = await requestIssue(maint, deptMaint, [{ item_id: item['BH-0002'], qty: 80 }]);
    // Duyệt vượt tồn khả dụng
    const over = await manager.post(`/api/issues/${id}/approve`).send({});
    expect(over.status).toBe(422);
    expect(over.body.error.message).toContain('Không đủ tồn khả dụng');
    // Duyệt 40
    const line = (await manager.get(`/api/issues/${id}`)).body.data.lines[0];
    const ap = await manager.post(`/api/issues/${id}/approve`).send({ lines: [{ id: line.id, qty_approved: 40 }] });
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    // Chưa xuất → tồn chưa giảm
    expect((await stockOf(item['BH-0002'])).usable).toBe(50);
    // Xuất vượt SL duyệt
    const bad = await officer.post(`/api/issues/${id}/issue`).send({ receiver_name: 'Hoàng Bảo Trì', lines: [{ id: line.id, allocations: [{ location_id: locA1, qty: 45 }] }] });
    expect(bad.status).toBe(422);
    const iss = await officer.post(`/api/issues/${id}/issue`).send({ receiver_name: 'Hoàng Bảo Trì', lines: [{ id: line.id, allocations: [{ location_id: locA1, qty: 40 }] }] });
    expect(iss.status, JSON.stringify(iss.body)).toBe(200);
    expect((await stockOf(item['BH-0002'])).usable).toBe(10);
    // Xác nhận nhận hàng – sai tên
    expect((await maint.post(`/api/issues/${id}/confirm`).send({ signature: 'Người khác' })).status).toBe(400);
    const cf = await maint.post(`/api/issues/${id}/confirm`).send({ signature: 'hoang bao tri' });
    expect(cf.status, JSON.stringify(cf.body)).toBe(200);
    const doc = await prisma.stockIssue.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('RECEIVED');
    expect(doc.receive_signature).toBe('hoang bao tri');
  });

  it('cảnh báo vượt định mức bắt buộc ghi lý do', async () => {
    await prisma.item.update({ where: { id: item['BH-0001'] }, data: { max_issue_qty: 5 } });
    const r = await maint.post('/api/issues').send({ warehouse_id: wh, doc_date: today(), department_id: deptMaint, purpose: 'Cấp phát PPE', lines: [{ item_id: item['BH-0001'], qty_requested: 10 }] });
    expect(r.status).toBe(422);
    const r2 = await maint.post('/api/issues').send({ warehouse_id: wh, doc_date: today(), department_id: deptMaint, purpose: 'Cấp phát PPE', quota_note: 'Công nhân mới', lines: [{ item_id: item['BH-0001'], qty_requested: 10 }] });
    expect(r2.status).toBe(200);
    expect(r2.body.data.quota_warning).toBe(true);
  });

  it('giữ chỗ: hai yêu cầu đã duyệt không vượt quá tồn', async () => {
    // BH-0002 còn 10
    const a = await requestIssue(maint, deptMaint, [{ item_id: item['BH-0002'], qty: 7 }]);
    const b = await requestIssue(mining, deptMining, [{ item_id: item['BH-0002'], qty: 7 }]);
    expect((await manager.post(`/api/issues/${a}/approve`).send({})).status).toBe(200);
    const rb = await manager.post(`/api/issues/${b}/approve`).send({});
    expect(rb.status).toBe(422); // khả dụng chỉ còn 3
    // Điều chỉnh giảm 5 cũng bị chặn vì đã giữ chỗ 7/10
    const adj = await officer.post('/api/adjustments').send({ warehouse_id: wh, doc_date: today(), reason: 'Mất mát kiểm tra', lines: [{ item_id: item['BH-0002'], location_id: locA1, qty_delta: -5 }] });
    await officer.post(`/api/adjustments/${adj.body.data.id}/submit`);
    expect((await manager.post(`/api/adjustments/${adj.body.data.id}/approve`).send({})).status).toBe(422);
    // Hủy phiếu đã duyệt → giải phóng giữ chỗ
    expect((await officer.post(`/api/issues/${a}/cancel`).send({ reason: 'Không dùng nữa' })).status).toBe(200);
    expect((await manager.post(`/api/issues/${b}/approve`).send({})).status).toBe(200);
  });
});

describe('10. Hủy giao dịch', () => {
  it('hủy được phiếu chưa ghi sổ, không hủy/xóa được phiếu đã ghi sổ', async () => {
    const r = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), lines: [{ item_id: item['DI-0001'], location_id: locA1, qty_doc: 10, qty_received: 10 }] });
    expect((await officer.post(`/api/receipts/${r.body.data.id}/cancel`).send({ reason: 'Lập nhầm' })).status).toBe(200);
    const posted = await receive([{ item_id: item['DI-0001'], qty: 100 }]);
    expect((await manager.post(`/api/receipts/${posted}/cancel`).send({ reason: 'Thử hủy' })).status).toBe(422);
    await expect(prisma.stockReceipt.delete({ where: { id: posted } })).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE stock_movements SET qty_in = 0 WHERE doc_id = ${posted}`).rejects.toThrow(/bất biến/);
  });
});

describe('11. Điều chỉnh tồn kho', () => {
  it('bắt buộc lý do, không tự duyệt, không làm âm kho', async () => {
    expect((await officer.post('/api/adjustments').send({ warehouse_id: wh, doc_date: today(), reason: '', lines: [{ item_id: item['DI-0001'], location_id: locA1, qty_delta: 5 }] })).status).toBe(400);
    const r = await officer.post('/api/adjustments').send({ warehouse_id: wh, doc_date: today(), reason: 'Phát hiện thừa khi sắp xếp kho', lines: [{ item_id: item['DI-0001'], location_id: locA1, qty_delta: 5 }] });
    await officer.post(`/api/adjustments/${r.body.data.id}/submit`);
    expect((await officer.post(`/api/adjustments/${r.body.data.id}/approve`).send({})).status).toBe(403);
    expect((await manager.post(`/api/adjustments/${r.body.data.id}/approve`).send({})).status).toBe(200);
    expect((await stockOf(item['DI-0001'])).usable).toBe(105);
    const neg = await officer.post('/api/adjustments').send({ warehouse_id: wh, doc_date: today(), reason: 'Giảm quá tồn để thử', lines: [{ item_id: item['DI-0001'], location_id: locA1, qty_delta: -1000 }] });
    await officer.post(`/api/adjustments/${neg.body.data.id}/submit`);
    const ap = await manager.post(`/api/adjustments/${neg.body.data.id}/approve`).send({});
    expect(ap.status).toBe(422);
    expect(ap.body.error.message).toContain('Không được xuất âm kho');
    expect((await stockOf(item['DI-0001'])).usable).toBe(105);
  });
});

describe('12-13. Kiểm kê', () => {
  it('chốt sổ, nhập thực tế không tự điều chỉnh; giải trình; duyệt mới ghi sổ', async () => {
    const st = await officer.post('/api/stocktakes').send({ warehouse_id: wh, name: 'Kiểm kê PPE tháng', scope_type: 'ITEMS', item_ids: [item['DI-0001'], item['TH-0001']] });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    const id = st.body.data.id;
    expect((await officer.post(`/api/stocktakes/${id}/freeze`)).status).toBe(200);
    const d = (await officer.get(`/api/stocktakes/${id}`)).body.data;
    const di = d.lines.find((l: { item_id: number }) => l.item_id === item['DI-0001']);
    const th = d.lines.find((l: { item_id: number }) => l.item_id === item['TH-0001']);
    expect(di.book_qty).toBe(105);
    expect(th.book_qty).toBe(0);
    await officer.put(`/api/stocktakes/${id}/counts`).send({ lines: [{ id: di.id, counted_qty: 100 }, { id: th.id, counted_qty: 0 }] });
    expect((await stockOf(item['DI-0001'])).usable).toBe(105); // nhập số kiểm không đổi tồn
    expect((await officer.post(`/api/stocktakes/${id}/submit`)).status).toBe(422); // thiếu giải trình
    await officer.put(`/api/stocktakes/${id}/counts`).send({ lines: [{ id: di.id, counted_qty: 100, reason: 'Hao hụt cắt cáp' }] });
    const sb = await officer.post(`/api/stocktakes/${id}/submit`);
    expect(sb.status, JSON.stringify(sb.body)).toBe(200);
    expect(sb.body.data.variance_lines).toBe(1);
    expect((await officer.post(`/api/stocktakes/${id}/approve`).send({})).status).toBe(403);
    const ap = await manager.post(`/api/stocktakes/${id}/approve`).send({});
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect((await stockOf(item['DI-0001'])).usable).toBe(100);
    expect((await prisma.stocktake.findUniqueOrThrow({ where: { id } })).status).toBe('POSTED');
    const rep = await manager.get(`/api/reports/stocktake-variance?from=${today()}&to=${today()}`);
    expect(rep.body.data.rows[0].variance).toBe(-5);
  });
});

describe('Điều chuyển & hàng trả lại', () => {
  it('điều chuyển giữa vị trí ghi sổ 2 chiều; hàng trả lại chỉ tăng khả dụng phần dùng được', async () => {
    const t = await officer.post('/api/transfers').send({ from_warehouse_id: wh, to_warehouse_id: wh, doc_date: today(), sender_name: 'Trần Thị Kho', receiver_name: 'Lê Văn Kiểm', reason: 'Sắp xếp kho', lines: [{ item_id: item['DI-0001'], from_location_id: locA1, to_location_id: locA2, qty: 30 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    await officer.post(`/api/transfers/${t.body.data.id}/submit`);
    expect((await manager.post(`/api/transfers/${t.body.data.id}/approve`).send({})).status).toBe(200);
    const bal = await prisma.inventoryBalance.findMany({ where: { item_id: item['DI-0001'] } });
    expect(Number(bal.find((b) => b.location_id === locA2)!.qty_usable)).toBe(30);
    expect((await stockOf(item['DI-0001'])).usable).toBe(100);

    const rt = await maint.post('/api/returns').send({ warehouse_id: wh, department_id: deptMaint, doc_date: today(), returned_by_name: 'Hoàng Bảo Trì', reason: 'Dư sau sửa chữa', lines: [{ item_id: item['BH-0002'], location_id: locA1, qty_returned: 5 }] });
    expect(rt.status, JSON.stringify(rt.body)).toBe(200);
    await maint.post(`/api/returns/${rt.body.data.id}/submit`);
    const line = (await officer.get(`/api/returns/${rt.body.data.id}`)).body.data.lines[0];
    expect((await officer.post(`/api/returns/${rt.body.data.id}/inspect`).send({ lines: [{ id: line.id, qty_usable: 3, qty_damaged: 2, qty_pending: 0 }] })).status).toBe(400); // thiếu nhận xét
    expect((await officer.post(`/api/returns/${rt.body.data.id}/inspect`).send({ lines: [{ id: line.id, qty_usable: 3, qty_damaged: 2, qty_pending: 0, inspection_note: '2 cái nứt' }] })).status).toBe(200);
    const before = await stockOf(item['BH-0002']);
    expect((await manager.post(`/api/returns/${rt.body.data.id}/approve`).send({})).status).toBe(200);
    const after = await stockOf(item['BH-0002']);
    expect(after.usable - before.usable).toBe(3);
    expect(after.damaged - before.damaged).toBe(2);
  });
});

describe('Tồn kho, thẻ kho, khóa kỳ', () => {
  it('thẻ kho có tồn lũy kế đúng; tồn tại thời điểm quá khứ', async () => {
    const c = (await officer.get(`/api/stock/card?item_id=${item['DI-0001']}&warehouse_id=${wh}&from=2020-01-01&to=${today()}`)).body.data;
    expect(c.closing).toBe(100);
    expect(c.rows.at(-1).balance).toBe(100);
    const past = (await officer.get(`/api/stock/balances?as_of=2020-01-01&q=DI-0001`)).body.data;
    expect(past[0].closing).toBe(0);
    const cur = (await officer.get(`/api/stock/balances?q=DI-0001`)).body.data;
    expect(cur[0].closing).toBe(100);
  });

  it('khóa kỳ chặn ghi sổ chứng từ thuộc kỳ đã khóa', async () => {
    expect((await officer.put('/api/settings').send({ 'inventory.lock_until': today() })).status).toBe(403);
    expect((await manager.put('/api/settings').send({ 'inventory.lock_until': today() })).status).toBe(200);
    const r = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), docs_checked: true, qty_checked: true, spec_checked: true, lines: [{ item_id: item['DI-0001'], location_id: locA1, qty_doc: 1, qty_received: 1 }] });
    const s = await officer.post(`/api/receipts/${r.body.data.id}/submit`);
    expect(s.status).toBe(422);
    expect(s.body.error.message).toContain('Kỳ kho đã khóa');
    expect((await manager.put('/api/settings').send({ 'inventory.lock_until': null })).status).toBe(200);
  });
});

describe('18-19. Phân quyền & nhật ký', () => {
  it('kiểm soát quyền truy cập', async () => {
    expect((await maint.get('/api/receipts')).status).toBe(403);
    expect((await accountant.post('/api/receipts').send({})).status).toBe(403);
    expect((await maint.get('/api/users')).status).toBe(403);
    const miningIssue = (await mining.get('/api/issues')).body.data[0];
    expect((await maint.get(`/api/issues/${miningIssue.id}`)).status).toBe(404); // không thấy phiếu bộ phận khác
    const sup = (await officer.post('/api/suppliers')).status;
    expect(sup).toBe(403);
    expect((await officer.get('/api/audit-logs')).status).toBe(403);
    // Thiếu header chống CSRF
    expect((await officer.agent.post('/api/items').send({})).status).toBe(403);
  });

  it('nhật ký ghi nhận phê duyệt với IP/phiên', async () => {
    const logs = (await admin.get('/api/audit-logs?action=APPROVE_POST&entity_type=stock_receipt')).body.data;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].username).toBe('quanlykho');
    expect(logs[0].session_id).toBeTruthy();
  });
});

describe('20. Báo cáo Excel/PDF & mẫu biểu', () => {
  it('xuất Excel, PDF và in phiếu', async () => {
    for (const key of ['receipts', 'issues', 'nxt', 'stock-current', 'stock-asof', 'below-min', 'no-movement', 'consumption-dept', 'transactions', 'stocktake-variance', 'damaged-returns']) {
      const j = await manager.get(`/api/reports/${key}`);
      expect(j.status, key + JSON.stringify(j.body)).toBe(200);
      const x = await manager.get(`/api/reports/${key}/export?format=xlsx`).buffer(true);
      expect(x.status, key).toBe(200);
      expect(x.headers['content-type']).toContain('spreadsheetml');
    }
    const pdf = await manager.get(`/api/reports/nxt/export?format=pdf`).buffer(true);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const card = await manager.get(`/api/reports/stock-card/export?format=pdf&item_id=${item['DI-0001']}`).buffer(true);
    expect(card.status).toBe(200);
    const rid = (await prisma.stockReceipt.findFirstOrThrow({ where: { status: 'POSTED' } })).id;
    const pr = await manager.get(`/api/print/receipt/${rid}`).buffer(true);
    expect(pr.status).toBe(200);
    expect(pr.headers['content-type']).toBe('application/pdf');
    const nxt = (await manager.get(`/api/reports/nxt?from=2020-01-01&to=${today()}&q=DI-0001`)).body.data;
    const row = nxt.rows[0];
    expect(row.opening + row.qty_in - row.qty_out).toBe(row.closing);
  });
});

describe('22-23. Đồng thời & toàn vẹn', () => {
  it('hai người cùng duyệt một phiếu – chỉ một lần ghi sổ', async () => {
    const r = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), docs_checked: true, qty_checked: true, spec_checked: true, lines: [{ item_id: item['TH-0001'], location_id: locA1, qty_doc: 10, qty_received: 10 }] });
    await officer.post(`/api/receipts/${r.body.data.id}/submit`);
    const adminMgr = admin;
    const res = await Promise.all([manager.post(`/api/receipts/${r.body.data.id}/approve`).send({}), adminMgr.post(`/api/receipts/${r.body.data.id}/approve`).send({})]);
    const codes = res.map((x) => x.status).sort();
    expect(codes).toEqual([200, 409]);
    const mv = await prisma.stockMovement.count({ where: { doc_type: 'RECEIPT', doc_id: r.body.data.id } });
    expect(mv).toBe(1);
  });

  it('xuất đồng thời nhiều phiếu cùng mặt hàng không làm âm/sai tồn', async () => {
    // TH-0001 có 10. Tạo 5 phiếu x 4 = 20, duyệt tuần tự sẽ chỉ được 2 phiếu
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) ids.push(await requestIssue(maint, deptMaint, [{ item_id: item['TH-0001'], qty: 4 }]));
    const approvals = await Promise.all(ids.map((id) => manager.post(`/api/issues/${id}/approve`).send({})));
    const okCount = approvals.filter((a) => a.status === 200).length;
    expect(okCount).toBe(2);
    const approved = ids.filter((_, i) => approvals[i].status === 200);
    const issued = await Promise.all(approved.map(async (id) => {
      const l = (await officer.get(`/api/issues/${id}`)).body.data.lines[0];
      return officer.post(`/api/issues/${id}/issue`).send({ receiver_name: 'Hoàng Bảo Trì', lines: [{ id: l.id, allocations: [{ location_id: locA1, qty: 4 }] }] });
    }));
    expect(issued.every((x) => x.status === 200)).toBe(true);
    expect((await stockOf(item['TH-0001'])).usable).toBe(2);
    const rc = (await officer.get('/api/stock/reconcile')).body.data;
    expect(rc.consistent).toBe(true);
  });

  it('chống tạo trùng chứng từ khi bấm lưu nhiều lần', async () => {
    const body = { client_request_id: 'dup-test-123', warehouse_id: wh, doc_date: today(), lines: [{ item_id: item['TH-0001'], location_id: locA1, qty_doc: 1, qty_received: 1 }] };
    const [a, b] = await Promise.all([officer.post('/api/receipts').send(body), officer.post('/api/receipts').send(body)]);
    const ids = new Set([a, b].filter((x) => x.status === 200).map((x) => x.body.data.id));
    expect(ids.size).toBe(1);
    expect(await prisma.stockReceipt.count({ where: { client_request_id: 'dup-test-123' } })).toBe(1);
  });
});

describe('21. Sao lưu & khôi phục', () => {
  it('tạo bản sao lưu, kiểm tra toàn vẹn, khôi phục', async () => {
    const b = await admin.post('/api/backups').send({ note: 'test' });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    const v = await admin.post(`/api/backups/${b.body.data.id}/verify`);
    expect(v.body.data.ok).toBe(true);
    const countBefore = await prisma.item.count();
    await officer.post('/api/items').send({ code: 'AFTER-BACKUP', name: 'Tạo sau sao lưu xyz', category_id: (await prisma.itemCategory.findFirstOrThrow()).id, unit_id: (await prisma.unit.findFirstOrThrow()).id, confirm_similar: true });
    expect(await prisma.item.count()).toBe(countBefore + 1);
    expect((await admin.post(`/api/backups/${b.body.data.id}/restore`).send({ confirm: 'sai' })).status).toBe(400);
    const rs = await admin.post(`/api/backups/${b.body.data.id}/restore`).send({ confirm: 'KHOI PHUC' });
    expect(rs.status, JSON.stringify(rs.body)).toBe(200);
    expect(await prisma.item.count()).toBe(countBefore);
    expect((await officer.get('/api/stock/reconcile')).body.data.consistent).toBe(true);
  });
});
