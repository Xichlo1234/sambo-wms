import { Router } from 'express';
import { prisma } from '../db';
import { can } from '../lib/auth';
import { ok } from '../lib/http';
import { normalizeText } from '../lib/text';

const r = Router();

/** Tìm kiếm nhanh toàn hệ thống – chỉ trả về dữ liệu người dùng được phép xem */
r.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return ok(res, []);
  const norm = normalizeText(q);
  const contains = { contains: q, mode: 'insensitive' as const };
  const results: { type: string; label: string; title: string; subtitle?: string; link: string }[] = [];
  const tasks: Promise<void>[] = [];
  if (can(req, 'items.view')) tasks.push(prisma.item.findMany({ where: { OR: [{ code: contains }, { search_text: { contains: norm } }, { barcode: q }] }, take: 8, select: { id: true, code: true, name: true, kind: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'item', label: x.kind === 'EQUIPMENT' ? 'Thiết bị' : 'Vật tư', title: `${x.code} – ${x.name}`, link: `/items/${x.id}` })); }));
  if (can(req, 'suppliers.view')) tasks.push(prisma.supplier.findMany({ where: { OR: [{ code: contains }, { search_text: { contains: norm } }, { tax_code: q }] }, take: 5, select: { id: true, code: true, name: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'supplier', label: 'Nhà cung cấp', title: `${x.code} – ${x.name}`, link: `/suppliers?id=${x.id}` })); }));
  if (can(req, 'receipts.view')) tasks.push(prisma.stockReceipt.findMany({ where: { OR: [{ code: contains }, { po_number: contains }, { supplier_doc_no: contains }] }, take: 5, select: { id: true, code: true, status: true, doc_date: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'receipt', label: 'Phiếu nhập', title: x.code, subtitle: x.doc_date.toISOString().slice(0, 10), link: `/receipts/${x.id}` })); }));
  if (can(req, 'issues.view') || can(req, 'issues.view_all')) {
    const scope = can(req, 'issues.view_all') ? {} : { OR: [{ requester_id: req.user!.id }, ...(req.user!.department_id ? [{ department_id: req.user!.department_id }] : [])] };
    tasks.push(prisma.stockIssue.findMany({ where: { AND: [scope, { OR: [{ code: contains }, { purpose: contains }] }] }, take: 5, select: { id: true, code: true, purpose: true } })
      .then((rows) => { rows.forEach((x) => results.push({ type: 'issue', label: 'Phiếu xuất', title: x.code, subtitle: x.purpose, link: `/issues/${x.id}` })); }));
  }
  if (can(req, 'stocktakes.view')) tasks.push(prisma.stocktake.findMany({ where: { OR: [{ code: contains }, { name: contains }] }, take: 3, select: { id: true, code: true, name: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'stocktake', label: 'Kiểm kê', title: x.code, subtitle: x.name, link: `/stocktakes/${x.id}` })); }));
  if (can(req, 'transfers.view')) tasks.push(prisma.stockTransfer.findMany({ where: { code: contains }, take: 3, select: { id: true, code: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'transfer', label: 'Điều chuyển', title: x.code, link: `/transfers/${x.id}` })); }));
  if (can(req, 'returns.view')) tasks.push(prisma.stockReturn.findMany({ where: { code: contains }, take: 3, select: { id: true, code: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'return', label: 'Hàng trả lại', title: x.code, link: `/returns/${x.id}` })); }));
  if (can(req, 'adjustments.view')) tasks.push(prisma.stockAdjustment.findMany({ where: { code: contains }, take: 3, select: { id: true, code: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'adjustment', label: 'Điều chỉnh', title: x.code, link: `/adjustments/${x.id}` })); }));
  if (can(req, 'departments.view')) tasks.push(prisma.department.findMany({ where: { OR: [{ code: contains }, { name: contains }] }, take: 3, select: { id: true, code: true, name: true } })
    .then((rows) => { rows.forEach((x) => results.push({ type: 'department', label: 'Bộ phận', title: `${x.code} – ${x.name}`, link: `/departments?id=${x.id}` })); }));
  await Promise.all(tasks);
  ok(res, results);
});

export default r;
