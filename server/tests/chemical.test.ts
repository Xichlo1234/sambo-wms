/**
 * KIỂM THỬ PHÂN HỆ KHO HÓA CHẤT – kịch bản 14–17 (XIX) + quy tắc an toàn, FEFO, đồng thời
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { login, today, type Client } from './helpers';
import { prisma } from '../src/db';

let khohc: Client, hse: Client, manager: Client, plant: Client, officer: Client, admin: Client;
let wh: number, locA1: number, locB1: number, locRecv: number, mainWh: number, deptPlant: number, supplier: number;
const chem: Record<string, number> = {};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const d = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

async function uploadSds(id: number, reviewDays = 365) {
  const r = await khohc.post(`/api/chemicals/${id}/documents`).field('doc_type', 'SDS').field('title', 'SDS nhà sản xuất').field('version', '1.0').field('review_date', d(reviewDays)).attach('file', PDF, 'sds.pdf');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data.id as number;
}

const checks = { chk_packaging: true, chk_label: true, chk_documents: true, chk_sds: true, chk_transport: true };

async function receiveChem(lines: Record<string, unknown>[], opts: { expectSubmit?: number } = {}) {
  const r = await khohc.post('/api/chemical-receipts').send({ warehouse_id: wh, doc_date: today(), received_date: today(), supplier_id: supplier, ...checks, lines });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const s = await khohc.post(`/api/chemical-receipts/${r.body.data.id}/submit`);
  expect(s.status, JSON.stringify(s.body)).toBe(opts.expectSubmit ?? 200);
  if ((opts.expectSubmit ?? 200) !== 200) return r.body.data.id as number;
  const a = await manager.post(`/api/chemical-receipts/${r.body.data.id}/approve`).send({});
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return r.body.data.id as number;
}

async function request(by: Client, lines: { chemical_id: number; qty: number }[]) {
  const r = await by.post('/api/chemical-issues').send({ warehouse_id: wh, doc_date: today(), department_id: deptPlant, purpose: 'Hòa tách quặng vàng ca 1', work_area: 'Bể hòa tách số 2', responsible_person: 'Trưởng ca Nhà máy', lines: lines.map((l) => ({ chemical_id: l.chemical_id, qty_requested: l.qty })) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect((await by.post(`/api/chemical-issues/${r.body.data.id}/submit`)).status).toBe(200);
  return r.body.data.id as number;
}

beforeAll(async () => {
  [khohc, hse, manager, plant, officer] = await Promise.all(['khohc', 'hse', 'quanlykho', 'nhamay', 'thukho'].map((u) => login(u)));
  admin = await login('admin', 'Admin@2026');
  wh = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO-HC' } })).id;
  mainWh = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO-TONG' } })).id;
  const loc = async (c: string) => (await prisma.warehouseLocation.findFirstOrThrow({ where: { code: c } })).id;
  locA1 = await loc('HC-A1'); locB1 = await loc('HC-B1'); locRecv = await loc('HC-NHAN');
  deptPlant = (await prisma.department.findUniqueOrThrow({ where: { code: 'PLANT' } })).id;
  supplier = (await prisma.supplier.findUniqueOrThrow({ where: { code: 'NCC002' } })).id;
  for (const c of ['HC-0001', 'HC-0002', 'HC-0003', 'HC-0004', 'HC-0005']) chem[c] = (await prisma.chemical.findUniqueOrThrow({ where: { code: c } })).id;
});

describe('Tách biệt kho hóa chất', () => {
  it('không dùng phiếu kho vật tư cho kho hóa chất và ngược lại', async () => {
    const it1 = (await prisma.item.findFirstOrThrow()).id;
    const r = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), lines: [{ item_id: it1, location_id: locA1, qty_doc: 1, qty_received: 1 }] });
    expect(r.status).toBe(400);
    const mainLoc = (await prisma.warehouseLocation.findFirstOrThrow({ where: { warehouse_id: mainWh } })).id;
    const r2 = await khohc.post('/api/chemical-receipts').send({ warehouse_id: mainWh, doc_date: today(), received_date: today(), ...checks, lines: [{ chemical_id: chem['HC-0002'], location_id: mainLoc, qty_doc: 1, qty_received: 1, batch_no: 'X', expiry_date: d(100) }] });
    expect(r2.status).toBe(422);
    expect(r2.body.error.message).toContain('Kho hóa chất');
    // Thủ kho vật tư không có quyền phân hệ hóa chất
    expect((await officer.get('/api/chemical-receipts')).status).toBe(403);
  });
});

describe('Danh mục & an toàn hóa chất', () => {
  it('kiểm tra CAS, xác nhận an toàn cần SDS, sửa trường an toàn thì hủy xác nhận', async () => {
    const unit = (await prisma.unit.findUniqueOrThrow({ where: { code: 'KG' } })).id;
    expect((await khohc.post('/api/chemicals').send({ code: 'HC-9001', name: 'Thử CAS', cas_number: '12345', unit_id: unit })).status).toBe(400);
    const c = await khohc.post('/api/chemicals').send({ code: 'hc-9001', name: 'Đồng sunfat', cas_number: '7758-98-7', unit_id: unit, ghs_pictograms: ['GHS07', 'GHS09'] });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    // HSE chưa có SDS → không xác nhận được
    expect((await hse.post(`/api/chemicals/${c.body.data.id}/verify-safety`).send({})).status).toBe(422);
    // Thủ kho hóa chất không có quyền xác nhận chuyên môn
    expect((await khohc.post(`/api/chemicals/${c.body.data.id}/verify-safety`).send({})).status).toBe(403);
    const docId = await uploadSds(c.body.data.id);
    expect((await hse.post(`/api/chemicals/documents/${docId}/verify`).send({})).status).toBe(200);
    expect((await hse.post(`/api/chemicals/${c.body.data.id}/verify-safety`).send({ note: 'Đã đối chiếu SDS mục 2, 7' })).status).toBe(200);
    const upd = await khohc.put(`/api/chemicals/${c.body.data.id}`).send({ code: 'HC-9001', name: 'Đồng sunfat', cas_number: '7758-98-7', unit_id: unit, ghs_pictograms: ['GHS07', 'GHS09'], ppe_req: 'Găng tay, kính' });
    expect(upd.body.data.safety_reverify_required).toBe(true);
    const nochange = await khohc.put(`/api/chemicals/${c.body.data.id}`).send({ code: 'HC-9001', name: 'Đồng sunfat pentahydrat', cas_number: '7758-98-7', unit_id: unit, ghs_pictograms: ['GHS09', 'GHS07'], ppe_req: 'Găng tay, kính' });
    expect(nochange.body.data.safety_reverify_required).toBe(false);
  });
});

describe('14. Nhập hóa chất theo nhiều lô', () => {
  it('chặn nhập khi thiếu SDS / thiếu lô / thiếu HSD / hóa chất đã hết hạn; nhập đạt tạo lô riêng, không gộp lô', async () => {
    const base = { chemical_id: chem['HC-0002'], location_id: locA1, qty_doc: 100, qty_received: 100 };
    // Chưa có SDS
    const id1 = await receiveChem([{ ...base, batch_no: 'L1', expiry_date: d(200) }], { expectSubmit: 422 });
    const sub = await khohc.post(`/api/chemical-receipts/${id1}/submit`);
    expect(sub.body.error.message).toContain('Chưa có SDS');
    for (const c of Object.values(chem)) await uploadSds(c);
    // Thiếu mã lô & HSD, hóa chất đã hết hạn
    const r = await khohc.put(`/api/chemical-receipts/${id1}`).send({ warehouse_id: wh, doc_date: today(), received_date: today(), ...checks, lines: [{ ...base }, { ...base, batch_no: 'OLD', expiry_date: d(-5) }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s2 = await khohc.post(`/api/chemical-receipts/${id1}/submit`);
    expect(s2.status).toBe(422);
    expect(s2.body.error.message).toContain('thiếu mã lô');
    expect(s2.body.error.message).toContain('thiếu hạn sử dụng');
    expect(s2.body.error.message).toContain('đã hết hạn');
    // Chưa kiểm tra đủ 5 bước tiếp nhận
    const noCheck = await khohc.post('/api/chemical-receipts').send({ warehouse_id: wh, doc_date: today(), received_date: today(), lines: [{ ...base, batch_no: 'L9', expiry_date: d(100) }] });
    const s3 = await khohc.post(`/api/chemical-receipts/${noCheck.body.data.id}/submit`);
    expect(s3.body.error.message).toContain('Chưa hoàn tất kiểm tra tiếp nhận');
    // Nhập 3 lô cùng hóa chất, khác HSD + 1 lô cách ly + 1 dòng không đạt
    const rid = await receiveChem([
      { ...base, batch_no: 'CAO-A', mfg_date: d(-30), expiry_date: d(20), qty_doc: 50, qty_received: 50 },
      { ...base, batch_no: 'CAO-B', expiry_date: d(400), qty_doc: 80, qty_received: 80 },
      { ...base, batch_no: 'CAO-A', expiry_date: d(45), qty_doc: 30, qty_received: 30 },
      { ...base, location_id: locRecv, batch_no: 'CAO-Q', expiry_date: d(300), qty_doc: 20, qty_received: 20, result: 'QUARANTINE', packaging_ok: false, condition_note: 'Bao rách nhẹ – chờ đánh giá' },
      { ...base, batch_no: 'CAO-X', expiry_date: d(300), qty_doc: 10, qty_received: 10, result: 'FAILED', condition_note: 'Ẩm, vón cục' },
    ]);
    const batches = await prisma.chemicalBatch.findMany({ where: { receipt_id: rid }, orderBy: { id: 'asc' } });
    expect(batches.length).toBe(4); // không đạt không nhập; 2 dòng cùng mã lô CAO-A nhưng HSD khác → 2 lô riêng
    expect(batches.filter((b) => b.batch_no === 'CAO-A').length).toBe(2);
    expect(batches.find((b) => b.batch_no === 'CAO-Q')!.qc_status).toBe('QUARANTINE');
    expect(batches.find((b) => b.batch_no === 'CAO-Q')!.abnormal).toBe(true);
    expect(batches.reduce((s, b) => s + Number(b.qty_on_hand), 0)).toBe(180);
    expect(new Set(batches.map((b) => b.internal_code)).size).toBe(4);
    // Người lập không tự duyệt
    const own = await khohc.post('/api/chemical-receipts').send({ warehouse_id: wh, doc_date: today(), received_date: today(), ...checks, lines: [{ ...base, batch_no: 'Z', expiry_date: d(100) }] });
    await khohc.post(`/api/chemical-receipts/${own.body.data.id}/submit`);
    expect((await khohc.post(`/api/chemical-receipts/${own.body.data.id}/approve`).send({})).status).toBe(403);
    expect((await khohc.post(`/api/chemical-receipts/${own.body.data.id}/refuse`).send({ reason: 'Hàng sai quy cách so với đơn' })).status).toBe(200);
  });
});

describe('15–16. Hạn sử dụng, cảnh báo, chặn xuất', () => {
  it('cảnh báo theo mốc 30/60/90 ngày; tồn được phép xuất loại trừ lô hết hạn/cách ly; chặn xuất lô hết hạn', async () => {
    // Tạo lô đã hết hạn bằng dữ liệu (mô phỏng thời gian trôi qua)
    const b = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-A', expiry_date: { lt: new Date(Date.now() + 25 * 86400_000) } } });
    await prisma.$executeRaw`UPDATE chemical_batches SET expiry_date = CURRENT_DATE - 1 WHERE id = ${b.id}`;
    const al = (await khohc.get('/api/chemical-batches/summary/alerts')).body.data;
    expect(al.expired).toBeGreaterThanOrEqual(1);
    expect(al.exp2).toBeGreaterThanOrEqual(1); // lô HSD +45 ngày nằm trong mốc 31–60
    expect(al.quarantine).toBeGreaterThanOrEqual(1);
    expect(al.abnormal).toBeGreaterThanOrEqual(1);
    const list = (await khohc.get('/api/chemical-batches?alert=expired')).body.data;
    expect(list.some((x: { id: number }) => x.id === b.id)).toBe(true);
    expect(list[0].block_reasons).toContain('Đã hết hạn sử dụng');
    const sum = (await khohc.get('/api/chemical-batches/summary/by-chemical?q=HC-0002')).body.data[0];
    expect(sum.on_hand).toBe(180);
    expect(sum.issuable).toBe(110); // 180 − 50 (hết hạn) − 20 (cách ly)
    // Xuất: yêu cầu 120 > 110 → duyệt bị chặn
    const big = await request(plant, [{ chemical_id: chem['HC-0002'], qty: 120 }]);
    const ap = await manager.post(`/api/chemical-issues/${big}/approve`).send({});
    expect(ap.status).toBe(422);
    expect(ap.body.error.message).toContain('đã loại lô hết hạn');
    const id = await request(plant, [{ chemical_id: chem['HC-0002'], qty: 40 }]);
    expect((await plant.post(`/api/chemical-issues/${id}/approve`).send({})).status).toBe(403);
    expect((await manager.post(`/api/chemical-issues/${id}/approve`).send({})).status).toBe(200);
    const line = (await khohc.get(`/api/chemical-issues/${id}`)).body.data.lines[0];
    // Cố tình chọn lô hết hạn → chặn, không có cách bỏ qua
    const r1 = await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: [{ batch_id: b.id, qty: 10 }] }] });
    expect(r1.status).toBe(422);
    expect(r1.body.error.message).toContain('Đã hết hạn sử dụng');
    // Chọn lô cách ly → chặn
    const q = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-Q' } });
    const r2 = await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: [{ batch_id: q.id, qty: 10 }] }] });
    expect(r2.body.error.message).toContain('Đang bị cách ly');
    // FEFO: lấy lô HSD xa (CAO-B) trước lô HSD gần (CAO-A +45) → chặn
    const near = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-A', id: { not: b.id } } });
    const far = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-B' } });
    const r3 = await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: [{ batch_id: far.id, qty: 40 }] }] });
    expect(r3.status).toBe(422);
    expect(r3.body.error.message).toContain('FEFO');
    // Gợi ý phân bổ FEFO đúng: hết lô gần (30) rồi lô xa (10)
    const sug = (await khohc.get(`/api/chemical-issues/${id}/allocation`)).body.data.lines[0].suggest;
    expect(sug).toEqual([{ batch_id: near.id, qty: 30 }, { batch_id: far.id, qty: 10 }]);
    const ok = await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: sug }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Number((await prisma.chemicalBatch.findUniqueOrThrow({ where: { id: near.id } })).qty_on_hand)).toBe(0);
    expect(Number((await prisma.chemicalBatch.findUniqueOrThrow({ where: { id: far.id } })).qty_on_hand)).toBe(70);
    const issued = await prisma.chemicalIssueItem.findUniqueOrThrow({ where: { id: line.id } });
    expect((issued.batch_detail as unknown[]).length).toBe(2); // lưu mã lô đã xuất
    expect((await plant.post(`/api/chemical-issues/${id}/confirm`).send({ signature: 'Ly Nha May' })).status).toBe(200);
    // Không giải phóng lô hết hạn cho sử dụng
    expect((await khohc.patch(`/api/chemical-batches/${b.id}/status`).send({ qc_status: 'PASSED', note: 'Thử giải phóng' })).status).toBe(422);
  });

  it('hóa chất kiểm soát đặc biệt phải được HSE xác nhận trước khi xuất', async () => {
    await receiveChem([{ chemical_id: chem['HC-0001'], location_id: locB1, qty_doc: 200, qty_received: 200, batch_no: 'NACN-01', expiry_date: d(500) }]);
    const id = await request(plant, [{ chemical_id: chem['HC-0001'], qty: 50 }]);
    expect((await manager.post(`/api/chemical-issues/${id}/approve`).send({})).status).toBe(200);
    const line = (await khohc.get(`/api/chemical-issues/${id}`)).body.data.lines[0];
    const batch = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'NACN-01' } });
    const r = await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: [{ batch_id: batch.id, qty: 50 }] }] });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('HSE');
    expect((await hse.post(`/api/chemical-issues/${id}/hse-confirm`).send({ note: 'Đủ PPE, có phương án ứng cứu' })).status).toBe(200);
    expect((await khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: line.id, allocations: [{ batch_id: batch.id, qty: 50 }] }] })).status).toBe(200);
  });

  it('SDS quá hạn rà soát chặn xuất (theo chính sách)', async () => {
    await receiveChem([{ chemical_id: chem['HC-0004'], location_id: locA1, qty_doc: 100, qty_received: 100, batch_no: 'NAOH-1', expiry_date: d(300) }]);
    await prisma.$executeRaw`UPDATE chemical_safety_documents SET review_date = CURRENT_DATE - 1 WHERE chemical_id = ${chem['HC-0004']} AND status = 'ACTIVE'`;
    const id = await request(plant, [{ chemical_id: chem['HC-0004'], qty: 10 }]);
    const ap = await manager.post(`/api/chemical-issues/${id}/approve`).send({});
    expect(ap.status).toBe(422);
    expect(ap.body.error.message).toContain('SDS quá hạn');
    await uploadSds(chem['HC-0004']); // cập nhật SDS mới
    expect((await manager.post(`/api/chemical-issues/${id}/approve`).send({})).status).toBe(200);
  });
});

describe('17. SDS/MSDS & an toàn', () => {
  it('phiên bản SDS mới thay thế bản cũ; cảnh báo lưu trữ không tương thích chỉ khi quy tắc đã xác nhận', async () => {
    const docs = await prisma.chemicalSafetyDocument.findMany({ where: { chemical_id: chem['HC-0004'], doc_type: 'SDS' } });
    expect(docs.filter((x) => x.status === 'ACTIVE').length).toBe(1);
    expect(docs.filter((x) => x.status === 'SUPERSEDED').length).toBeGreaterThanOrEqual(1);
    const rule = await khohc.post('/api/chemical-safety/storage-rules').send({ chemical_a_id: chem['HC-0003'], chemical_b_id: chem['HC-0004'], description: 'Không lưu trữ chung khu vực', source_ref: 'SDS mục 7 & 10' });
    expect(rule.status).toBe(200);
    const draft = await khohc.post('/api/chemical-receipts').send({ warehouse_id: wh, doc_date: today(), received_date: today(), ...checks, lines: [{ chemical_id: chem['HC-0003'], location_id: locA1, qty_doc: 10, qty_received: 10, batch_no: 'HCL-1', expiry_date: d(200) }] });
    let det = (await khohc.get(`/api/chemical-receipts/${draft.body.data.id}`)).body.data;
    expect(det.storage_warnings.length).toBe(0); // chưa xác nhận → không cảnh báo
    expect((await hse.post(`/api/chemical-safety/storage-rules/${rule.body.data.id}/verify`).send({})).status).toBe(200);
    det = (await khohc.get(`/api/chemical-receipts/${draft.body.data.id}`)).body.data;
    expect(det.storage_warnings[0]).toContain('KHÔNG tương thích');
    const rep = await manager.get('/api/reports/chem-sds');
    expect(rep.status).toBe(200);
  });

  it('nhật ký kiểm tra kho & sự cố', async () => {
    expect((await hse.post('/api/chemical-inspections').send({ warehouse_id: wh, inspected_at: new Date().toISOString(), ventilation_ok: true, fire_equipment_ok: false, spill_kit_ok: true, labeling_ok: true, segregation_ok: true, ppe_ok: true })).status).toBe(400);
    expect((await hse.post('/api/chemical-inspections').send({ warehouse_id: wh, inspected_at: new Date().toISOString(), temperature: 28, humidity: 70, ventilation_ok: true, fire_equipment_ok: false, spill_kit_ok: true, labeling_ok: true, segregation_ok: true, ppe_ok: true, findings: 'Bình chữa cháy hết hạn kiểm định', actions: 'Thay bình trong 24h' })).status).toBe(200);
    const inc = await khohc.post('/api/chemical-incidents').send({ occurred_at: new Date().toISOString(), warehouse_id: wh, chemical_id: chem['HC-0003'], incident_type: 'LEAK', severity: 'MEDIUM', description: 'Rò rỉ nắp can khi vận chuyển nội bộ' });
    expect(inc.status).toBe(200);
    expect((await khohc.post(`/api/chemical-incidents/${inc.body.data.id}/close`).send({ actions_taken: 'Xử lý theo hướng dẫn SDS mục 6, thay can' })).status).toBe(200);
  });
});

describe('Kiểm kê hóa chất theo lô & tiêu hủy', () => {
  it('kiểm kê theo lô, bắt buộc tình trạng bao bì & giải trình, duyệt mới điều chỉnh; tiêu hủy lô hết hạn', async () => {
    const st = await khohc.post('/api/chemical-stocktakes').send({ warehouse_id: wh, name: 'Kiểm kê vôi', chemical_ids: [chem['HC-0002']] });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    const det = (await khohc.get(`/api/chemical-stocktakes/${st.body.data.id}`)).body.data;
    const far = det.lines.find((l: { batch: { batch_no: string } }) => l.batch.batch_no === 'CAO-B');
    const counts = det.lines.map((l: { id: number; book_qty: number }) => ({ id: l.id, counted_qty: l.id === far.id ? 68 : l.book_qty, packaging_ok: true }));
    await khohc.put(`/api/chemical-stocktakes/${st.body.data.id}/counts`).send({ lines: counts });
    expect((await khohc.post(`/api/chemical-stocktakes/${st.body.data.id}/submit`)).status).toBe(422);
    counts.find((c: { id: number }) => c.id === far.id).reason = 'Hao hụt do bao rách khi bốc xếp';
    await khohc.put(`/api/chemical-stocktakes/${st.body.data.id}/counts`).send({ lines: counts });
    expect((await khohc.post(`/api/chemical-stocktakes/${st.body.data.id}/submit`)).status).toBe(200);
    expect(Number((await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-B' } })).qty_on_hand)).toBe(70);
    expect((await khohc.post(`/api/chemical-stocktakes/${st.body.data.id}/approve`).send({})).status).toBe(403);
    expect((await manager.post(`/api/chemical-stocktakes/${st.body.data.id}/approve`).send({})).status).toBe(200);
    expect(Number((await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-B' } })).qty_on_hand)).toBe(68);
    // Tiêu hủy lô hết hạn
    const exp = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'CAO-A', expiry_date: { lt: new Date() } } });
    expect((await khohc.post('/api/chemical-adjustments').send({ warehouse_id: wh, adj_type: 'DISPOSAL', doc_date: today(), reason: 'Tiêu hủy hóa chất hết hạn', lines: [{ batch_id: exp.id, qty_delta: -50 }] })).status).toBe(400);
    const adj = await khohc.post('/api/chemical-adjustments').send({ warehouse_id: wh, adj_type: 'DISPOSAL', doc_date: today(), reason: 'Tiêu hủy hóa chất hết hạn', disposal_method: 'Chuyển đơn vị xử lý chất thải nguy hại có giấy phép', lines: [{ batch_id: exp.id, qty_delta: -50 }] });
    expect(adj.status).toBe(200);
    await khohc.post(`/api/chemical-adjustments/${adj.body.data.id}/submit`);
    expect((await manager.post(`/api/chemical-adjustments/${adj.body.data.id}/approve`).send({})).status).toBe(200);
    expect(Number((await prisma.chemicalBatch.findUniqueOrThrow({ where: { id: exp.id } })).qty_on_hand)).toBe(0);
  });
});

describe('Đồng thời & toàn vẹn sổ lô', () => {
  it('nhiều phiếu xuất đồng thời không làm âm lô; sổ cái lô khớp tồn lô; sổ cái bất biến', async () => {
    // HC-0001: còn 150 khả dụng. 4 yêu cầu × 50 → chỉ 3 được duyệt
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) ids.push(await request(plant, [{ chemical_id: chem['HC-0001'], qty: 50 }]));
    const res = await Promise.all(ids.map((id) => manager.post(`/api/chemical-issues/${id}/approve`).send({})));
    expect(res.filter((r) => r.status === 200).length).toBe(3);
    const batch = await prisma.chemicalBatch.findFirstOrThrow({ where: { batch_no: 'NACN-01' } });
    const approved = ids.filter((_, i) => res[i].status === 200);
    for (const id of approved) await hse.post(`/api/chemical-issues/${id}/hse-confirm`).send({ note: 'OK an toàn' });
    const out = await Promise.all(approved.map(async (id) => {
      const l = (await khohc.get(`/api/chemical-issues/${id}`)).body.data.lines[0];
      return khohc.post(`/api/chemical-issues/${id}/issue`).send({ receiver_name: 'Lý Nhà Máy', lines: [{ id: l.id, allocations: [{ batch_id: batch.id, qty: 50 }] }] });
    }));
    expect(out.every((x) => x.status === 200)).toBe(true);
    expect(Number((await prisma.chemicalBatch.findUniqueOrThrow({ where: { id: batch.id } })).qty_on_hand)).toBe(0);
    const mism = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM chemical_batches b WHERE b.qty_on_hand <> (SELECT COALESCE(SUM(qty_in - qty_out),0) FROM chemical_movements m WHERE m.batch_id = b.id)`;
    expect(mism[0].n).toBe(0);
    await expect(prisma.$executeRaw`DELETE FROM chemical_movements WHERE batch_id = ${batch.id}`).rejects.toThrow(/bất biến/);
  });

  it('báo cáo hóa chất & mẫu in hoạt động', async () => {
    for (const key of ['chem-stock', 'chem-batches', 'chem-nxt', 'chem-expiring', 'chem-expired', 'chem-by-supplier', 'chem-consumption', 'chem-quarantine', 'chem-stocktake', 'chem-sds']) {
      const r = await manager.get(`/api/reports/${key}?from=2020-01-01&to=${today()}`);
      expect(r.status, key + JSON.stringify(r.body)).toBe(200);
      const x = await manager.get(`/api/reports/${key}/export?format=pdf&from=2020-01-01&to=${today()}`).buffer(true);
      expect(x.status, key).toBe(200);
    }
    const nxt = (await manager.get(`/api/reports/chem-nxt?from=2020-01-01&to=${today()}&q=HC-0002`)).body.data.rows[0];
    expect(nxt.opening + nxt.qty_in - nxt.qty_out).toBeCloseTo(nxt.closing);
    const rc = await prisma.chemicalReceipt.findFirstOrThrow({ where: { status: 'POSTED' } });
    expect((await manager.get(`/api/print/chem-receipt/${rc.id}`)).status).toBe(200);
    const ci = await prisma.chemicalIssue.findFirstOrThrow({ where: { status: { in: ['ISSUED', 'RECEIVED'] } } });
    expect((await khohc.get(`/api/print/chem-issue/${ci.id}`)).status).toBe(200);
    expect(admin).toBeTruthy();
  });
});

describe('Hồi quy: trường để trống không bị ép thành 0 / 1970', () => {
  it('nhiệt độ bảo quản trống giữ null; ngày giao dự kiến trống giữ null', async () => {
    const unit = (await prisma.unit.findUniqueOrThrow({ where: { code: 'LIT' } })).id;
    const c = await khohc.post('/api/chemicals').send({ code: 'HC-NULL', name: 'Kiểm tra null', unit_id: unit, storage_temp_min: null, storage_temp_max: '', default_shelf_life_days: null });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const row = await prisma.chemical.findUniqueOrThrow({ where: { code: 'HC-NULL' } });
    expect(row.storage_temp_min).toBeNull();
    expect(row.storage_temp_max).toBeNull();
    const r = await khohc.post('/api/chemical-receipts').send({ warehouse_id: wh, doc_date: today(), received_date: today(), ...checks, lines: [{ chemical_id: row.id, location_id: locA1, qty_doc: 1, qty_received: 1, unit_price: null, mfg_date: null, expiry_date: '' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const line = await prisma.chemicalReceiptItem.findFirstOrThrow({ where: { receipt_id: r.body.data.id } });
    expect(line.unit_price).toBeNull();
    expect(line.mfg_date).toBeNull();
  });
});
