/**
 * KIỂM THỬ MUA HÀNG: Đề nghị mua → Yêu cầu báo giá → So sánh → Đơn đặt hàng → Nhập kho (một phần / đủ) → Đánh giá NCC
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { login, today, type Client } from './helpers';
import { prisma } from '../src/db';

let maint: Client, buyer: Client, manager: Client, director: Client, officer: Client, officer2: Client, khohc: Client, accountant: Client;
let deptMaint: number, sup1: number, sup2: number, wh: number, chemWh: number, locA1: number, locHc: number;
const item: Record<string, number> = {};
let prId = 0, poId = 0;
const d = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [maint, buyer, manager, director, officer, officer2, khohc, accountant] = await Promise.all(['baotri', 'muahang', 'quanlykho', 'giamdoc', 'thukho', 'thukho2', 'khohc', 'ketoan'].map((u) => login(u)));
  deptMaint = (await prisma.department.findUniqueOrThrow({ where: { code: 'MAINT' } })).id;
  sup1 = (await prisma.supplier.findUniqueOrThrow({ where: { code: 'NCC001' } })).id;
  sup2 = (await prisma.supplier.findUniqueOrThrow({ where: { code: 'NCC002' } })).id;
  wh = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO-TONG' } })).id;
  chemWh = (await prisma.warehouse.findUniqueOrThrow({ where: { code: 'KHO-HC' } })).id;
  locA1 = (await prisma.warehouseLocation.findFirstOrThrow({ where: { code: 'A-01' } })).id;
  locHc = (await prisma.warehouseLocation.findFirstOrThrow({ where: { code: 'HC-A2' } })).id;
  for (const c of ['TH-0002', 'PT-0002', 'XD-0001']) item[c] = (await prisma.item.findUniqueOrThrow({ where: { code: c } })).id;
});

describe('Đề nghị mua hàng', () => {
  it('gợi ý từ tồn thấp (không tự đặt hàng); lập – duyệt độc lập', async () => {
    const sug = (await buyer.get('/api/purchase-requests/suggestions')).body.data;
    expect(sug.some((s: { code: string }) => s.code === 'TH-0002')).toBe(true);
    expect(await prisma.purchaseOrder.count()).toBe(0); // không tự động tạo đơn hàng
    const r = await maint.post('/api/purchase-requests').send({
      request_date: today(), department_id: deptMaint, purpose: 'Bổ sung vật tư bảo trì quý IV', priority: 'HIGH', needed_date: d(14),
      lines: [{ item_id: item['TH-0002'], qty: 100, unit_code: 'VIEN' }, { item_id: item['PT-0002'], qty: 20 }, { chemical_id: (await prisma.chemical.findUniqueOrThrow({ where: { code: 'HC-0005' } })).id, qty: 300 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    prId = r.body.data.id;
    expect((await maint.post('/api/purchase-requests').send({ request_date: today(), department_id: deptMaint, purpose: 'Sai dòng', lines: [{ qty: 1 }] })).status).toBe(400);
    expect((await maint.post(`/api/purchase-requests/${prId}/submit`)).status).toBe(200);
    // Chưa duyệt → chưa lập được báo giá / PO
    expect((await buyer.post('/api/quotes').send({ request_id: prId, supplier_ids: [sup1] })).status).toBe(422);
    expect((await maint.post(`/api/purchase-requests/${prId}/approve`).send({})).status).toBe(403);
    expect((await manager.post(`/api/purchase-requests/${prId}/approve`).send({ comment: 'Đồng ý' })).status).toBe(200);
  });
});

describe('Yêu cầu báo giá & so sánh', () => {
  it('gửi RFQ cho 2 NCC, nhập giá, so sánh, chọn báo giá tốt nhất', async () => {
    const q = await buyer.post('/api/quotes').send({ request_id: prId, supplier_ids: [sup1, sup2] });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const [q1, q2] = q.body.data;
    const det1 = (await buyer.get(`/api/quotes/${q1.id}`)).body.data;
    await buyer.put(`/api/quotes/${q1.id}`).send({ quote_no: 'BG-A-01', quote_date: today(), currency: 'VND', delivery_days: 7, lines: det1.lines.map((l: { id: number }, i: number) => ({ id: l.id, unit_price: [15000, 520000, 40000][i] })) });
    const det2 = (await buyer.get(`/api/quotes/${q2.id}`)).body.data;
    await buyer.put(`/api/quotes/${q2.id}`).send({ quote_no: 'BG-B-07', quote_date: today(), currency: 'VND', delivery_days: 10, lines: det2.lines.map((l: { id: number }, i: number) => ({ id: l.id, unit_price: [14000, 550000, 42000][i] })) });
    const cmp = (await buyer.get(`/api/purchase-requests/${prId}/compare`)).body.data;
    expect(cmp.quotes.length).toBe(2);
    expect(cmp.lines[0].best).toBe(14000);
    // Người không có quyền xem giá
    const cmpMaint = (await maint.get(`/api/purchase-requests/${prId}/compare`)).body.data;
    expect(cmpMaint.lines[0].best).toBeNull();
  });
});

describe('Đơn đặt hàng → nhập kho', () => {
  it('lập PO từ báo giá, duyệt độc lập, gửi NCC, nhận một phần, chặn nhận vượt, nhận đủ', async () => {
    const pr = (await buyer.get(`/api/purchase-requests/${prId}`)).body.data;
    const q1 = pr.quotes.find((q: { supplier_id: number }) => q.supplier_id === sup1);
    const itemLines = pr.lines.filter((l: { item_id: number | null }) => l.item_id);
    const po = await buyer.post('/api/purchase-orders').send({
      supplier_id: sup1, request_id: prId, quote_id: q1.id, order_date: today(), expected_date: d(7), currency: 'VND', payment_terms: '30 ngày',
      lines: itemLines.map((l: { id: number; item_id: number; qty: number }) => ({ pr_item_id: l.id, item_id: l.item_id, qty_ordered: l.qty, unit_price: q1.lines.find((x: { pr_item_id: number }) => x.pr_item_id === l.id).unit_price })),
    });
    expect(po.status, JSON.stringify(po.body)).toBe(200);
    poId = po.body.data.id;
    expect(Number(po.body.data.total_amount)).toBe(100 * 15000 + 20 * 520000);
    // Phiếu nhập trước khi PO được duyệt → chặn
    const early = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), purchase_order_id: poId, lines: [{ item_id: item['TH-0002'], location_id: locA1, qty_doc: 1, qty_received: 1 }] });
    expect(early.status).toBe(422);
    expect((await buyer.post(`/api/purchase-orders/${poId}/submit`)).status).toBe(200);
    expect((await buyer.post(`/api/purchase-orders/${poId}/approve`).send({})).status).toBe(403);
    expect((await director.post(`/api/purchase-orders/${poId}/approve`).send({})).status).toBe(200);
    expect((await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: prId } })).status).toBe('ORDERED');
    expect((await buyer.post(`/api/purchase-orders/${poId}/send`)).status).toBe(200);
    const pod = (await officer.get(`/api/purchase-orders/${poId}`)).body.data;
    const lTh = pod.lines.find((l: { item_id: number }) => l.item_id === item['TH-0002']);
    const lPt = pod.lines.find((l: { item_id: number }) => l.item_id === item['PT-0002']);
    expect(lTh.unit_price).toBeNull(); // thủ kho không xem giá mua
    // Nhận vượt SL đặt → chặn
    const over = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), purchase_order_id: poId, docs_checked: true, qty_checked: true, spec_checked: true, lines: [{ item_id: item['TH-0002'], po_item_id: lTh.id, location_id: locA1, qty_doc: 120, qty_received: 120 }] });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toContain('vượt SL còn lại');
    // Nhập sai mặt hàng so với dòng PO
    const wrong = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), purchase_order_id: poId, lines: [{ item_id: item['XD-0001'], po_item_id: lTh.id, location_id: locA1, qty_doc: 1, qty_received: 1 }] });
    expect(wrong.status).toBe(400);
    // Lần 1: nhận 60 TH (5 không đạt) + 20 PT
    const r1 = await officer.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), purchase_order_id: poId, docs_checked: true, qty_checked: true, spec_checked: true, lines: [
      { item_id: item['TH-0002'], po_item_id: lTh.id, location_id: locA1, qty_doc: 60, qty_received: 60, qty_rejected: 5, condition_note: '5 viên nứt' },
      { item_id: item['PT-0002'], po_item_id: lPt.id, location_id: locA1, qty_doc: 20, qty_received: 20 },
    ] });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.data.po_number).toBe(pod.code);
    await officer.post(`/api/receipts/${r1.body.data.id}/submit`);
    expect((await manager.post(`/api/receipts/${r1.body.data.id}/approve`).send({})).status).toBe(200);
    let poNow = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    expect(poNow.status).toBe('PARTIAL');
    expect(Number(poNow.lines.find((l) => l.id === lTh.id)!.qty_received)).toBe(55);
    // PO đã nhận hàng → không hủy được
    expect((await buyer.post(`/api/purchase-orders/${poId}/cancel`).send({ reason: 'Thử hủy' })).status).toBe(422);
    // Hai phiếu nhận phần còn lại (45) đồng thời mỗi phiếu 45 → chỉ một phiếu được ghi sổ
    const mk = async (by: Client) => {
      const r = await by.post('/api/receipts').send({ warehouse_id: wh, doc_date: today(), purchase_order_id: poId, docs_checked: true, qty_checked: true, spec_checked: true, lines: [{ item_id: item['TH-0002'], po_item_id: lTh.id, location_id: locA1, qty_doc: 45, qty_received: 45 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await by.post(`/api/receipts/${r.body.data.id}/submit`)).status).toBe(200);
      return r.body.data.id as number;
    };
    const [a, b] = [await mk(officer), await mk(officer2)];
    const res = await Promise.all([manager.post(`/api/receipts/${a}/approve`).send({}), director.post(`/api/receipts/${b}/approve`).send({})]);
    const statuses = res.map((x) => x.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200);
    poNow = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
    expect(poNow.status).toBe('RECEIVED');
    expect(Number(poNow.lines.find((l) => l.id === lTh.id)!.qty_received)).toBe(100);
  });

  it('PO hóa chất liên kết phiếu nhập hóa chất', async () => {
    const pr = (await buyer.get(`/api/purchase-requests/${prId}`)).body.data;
    const cl = pr.lines.find((l: { chemical_id: number | null }) => l.chemical_id);
    const po = await buyer.post('/api/purchase-orders').send({ supplier_id: sup2, request_id: prId, order_date: d(-10), expected_date: d(-2), currency: 'VND', lines: [{ pr_item_id: cl.id, chemical_id: cl.chemical_id, qty_ordered: 300, unit_price: 42000 }] });
    expect(po.status, JSON.stringify(po.body)).toBe(200);
    await buyer.post(`/api/purchase-orders/${po.body.data.id}/submit`);
    await director.post(`/api/purchase-orders/${po.body.data.id}/approve`).send({});
    const late = (await buyer.get('/api/purchase-orders?late=1')).body.data;
    expect(late.some((x: { id: number; is_late: boolean }) => x.id === po.body.data.id && x.is_late)).toBe(true);
    const pol = (await khohc.get(`/api/purchase-orders/${po.body.data.id}`)).body.data.lines[0];
    const rc = await khohc.post('/api/chemical-receipts').send({ warehouse_id: chemWh, doc_date: today(), received_date: today(), supplier_id: sup2, purchase_order_id: po.body.data.id, chk_packaging: true, chk_label: true, chk_documents: true, chk_sds: true, chk_transport: true,
      lines: [{ chemical_id: cl.chemical_id, po_item_id: pol.id, location_id: locHc, qty_doc: 300, qty_received: 300, batch_no: 'AC-2026-11', expiry_date: d(700) }] });
    expect(rc.status, JSON.stringify(rc.body)).toBe(200);
    expect((await khohc.post(`/api/chemical-receipts/${rc.body.data.id}/submit`)).status).toBe(200);
    expect((await manager.post(`/api/chemical-receipts/${rc.body.data.id}/approve`).send({})).status).toBe(200);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.body.data.id } })).status).toBe('RECEIVED');
  });
});

describe('Nhà cung cấp', () => {
  it('hồ sơ thống kê, so sánh theo mặt hàng, đánh giá, khiếu nại, báo cáo mua hàng', async () => {
    const prof = (await buyer.get(`/api/suppliers/${sup1}/profile`)).body.data;
    expect(prof.stats.po_count).toBe(1);
    expect(prof.stats.defect_rate).toBeGreaterThan(0);
    expect(prof.stats.shortage_rate).toBeGreaterThanOrEqual(0); // phụ thuộc phiếu nhập NCC001 ở bộ test kho mỏ
    const needEval = (await buyer.get('/api/suppliers/need-evaluation')).body.data;
    expect(needEval.some((s: { id: number }) => s.id === sup1)).toBe(true);
    const cmp = (await buyer.get(`/api/suppliers/compare?item_id=${item['TH-0002']}`)).body.data;
    expect(cmp.length).toBe(2); // 1 có đơn hàng, 1 có báo giá
    expect((await buyer.post(`/api/suppliers/${sup1}/evaluations`).send({ period_from: d(-90), period_to: today(), quality_score: 6, delivery_score: 4, price_score: 4, service_score: 4 })).status).toBe(400);
    const ev = await buyer.post(`/api/suppliers/${sup1}/evaluations`).send({ period_from: d(-90), period_to: today(), quality_score: 4, delivery_score: 5, price_score: 4, service_score: 4, comment: 'Giao đúng hạn' });
    expect(ev.status).toBe(200);
    expect(ev.body.data.classification).toBe('A');
    const cp = await buyer.post(`/api/suppliers/${sup1}/complaints`).send({ complaint_date: today(), subject: 'Hàng nứt vỡ', description: '5 viên đá mài nứt khi nhận', related_doc: 'PN' });
    expect(cp.status).toBe(200);
    for (const key of ['pr-report', 'po-report', 'po-delivery', 'purchase-by-supplier', 'supplier-evaluation']) {
      const r = await accountant.get(`/api/reports/${key}?from=2020-01-01&to=${today()}`);
      expect(r.status, key + JSON.stringify(r.body)).toBe(200);
    }
    expect((await buyer.get(`/api/print/po/${poId}`)).status).toBe(200);
    const dash = (await director.get('/api/dashboard')).body.data;
    expect(dash.purchase).toBeTruthy();
    expect(dash.chemical).toBeTruthy();
  });
});
