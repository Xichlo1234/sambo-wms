/**
 * PHIẾU XUẤT KHO / YÊU CẦU CẤP VẬT TƯ (5.1.3)
 * DRAFT → SUBMITTED → APPROVED (giữ chỗ tồn) → ISSUED (ghi sổ, giảm tồn) → RECEIVED (người nhận xác nhận điện tử)
 *                   ↘ REJECTED (sửa & gửi lại)          ↘ CANCELLED (giải phóng giữ chỗ)
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, assertNotSelf, can } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, forbidden, notFound, ruleViolation } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { nextDocNo, DOC_PREFIX } from '../lib/docno';
import { transition } from '../lib/doc';
import { notifyPermission, notifyUsers } from '../lib/notify';
import { getSetting } from '../lib/settings';
import { normalizeText } from '../lib/text';
import { getAvailability, lockItems, postMovements, toDateOnly, assertPeriodOpen, type MoveInput } from '../services/inventory';

const r = Router();
const ENTITY = 'stock_issue';
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const issueSchema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho'),
  doc_date: z.coerce.date({ errorMap: () => ({ message: 'Ngày chứng từ không hợp lệ' }) }),
  department_id: z.coerce.number().int().positive('Chọn bộ phận nhận'),
  purpose: z.string().trim().min(3, 'Bắt buộc ghi rõ mục đích sử dụng'),
  work_area: zOptStr,
  receiver_name: zOptStr,
  quota_note: zOptStr,
  note: zOptStr,
  lines: z.array(z.object({
    item_id: z.coerce.number().int().positive('Chọn vật tư'),
    qty_requested: z.coerce.number().positive('SL yêu cầu phải > 0'),
    note: zOptStr,
  })).min(1, 'Phải có ít nhất 1 dòng vật tư'),
});

const detailInclude = {
  warehouse: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  requester: { select: { id: true, full_name: true } },
  approver: { select: { id: true, full_name: true } },
  issuer: { select: { id: true, full_name: true } },
  lines: {
    orderBy: { line_no: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, specification: true, max_issue_qty: true, default_location_id: true, unit: { select: { code: true } } } },
      location: { select: { id: true, code: true, name: true } },
    },
  },
} satisfies Prisma.StockIssueInclude;

/** Phạm vi dữ liệu: người không có issues.view_all chỉ thấy phiếu của bộ phận mình hoặc do mình yêu cầu */
function scopeWhere(req: Request): Prisma.StockIssueWhereInput {
  if (can(req, 'issues.view_all')) return {};
  const u = req.user!;
  return { OR: [{ requester_id: u.id }, ...(u.department_id ? [{ department_id: u.department_id }] : [])] };
}

async function loadScoped(req: Request, id: number) {
  const doc = await prisma.stockIssue.findFirst({ where: { id, ...scopeWhere(req) }, include: detailInclude });
  if (!doc) throw notFound('Không tìm thấy phiếu xuất hoặc bạn không có quyền xem');
  return doc;
}

async function validate(req: Request, d: z.infer<typeof issueSchema>) {
  if (!can(req, 'issues.view_all') && d.department_id !== req.user!.department_id) {
    throw forbidden('Bạn chỉ được lập yêu cầu cấp vật tư cho bộ phận của mình');
  }
  const [wh, dept] = await Promise.all([
    prisma.warehouse.findUnique({ where: { id: d.warehouse_id } }),
    prisma.department.findUnique({ where: { id: d.department_id } }),
  ]);
  if (!wh || wh.status !== 'ACTIVE') throw badRequest('Kho không tồn tại hoặc đã khóa');
  if (wh.type !== 'GENERAL') throw badRequest('Xuất hóa chất phải dùng phân hệ Xuất hóa chất (5.2)');
  if (!dept || dept.status !== 'ACTIVE') throw badRequest('Bộ phận không tồn tại hoặc đã khóa');
  const ids = d.lines.map((l) => l.item_id);
  if (new Set(ids).size !== ids.length) throw badRequest('Có vật tư bị lặp trong phiếu. Vui lòng gộp thành một dòng.');
  const items = await prisma.item.findMany({ where: { id: { in: ids } } });
  let quotaWarning = false;
  const warnings: string[] = [];
  for (const l of d.lines) {
    const it = items.find((x) => x.id === l.item_id);
    if (!it) throw badRequest(`Vật tư ID ${l.item_id} không tồn tại`);
    if (it.status !== 'ACTIVE') throw badRequest(`Vật tư ${it.code} đã bị khóa`);
    if (it.max_issue_qty && D(l.qty_requested).gt(it.max_issue_qty)) {
      quotaWarning = true;
      warnings.push(`${it.code}: yêu cầu ${l.qty_requested} > định mức ${it.max_issue_qty.toString()}`);
    }
  }
  if (quotaWarning && (await getSetting<boolean>('issue.require_quota_note')) && !d.quota_note) {
    throw ruleViolation(`Yêu cầu vượt định mức cấp phát (${warnings.join('; ')}). Bắt buộc ghi lý do vượt định mức.`, { warnings });
  }
  return { quotaWarning };
}

r.get('/', requirePerm('issues.view', 'issues.view_all'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.StockIssueWhereInput[] = [scopeWhere(req)];
  const q = String(req.query.q || '').trim();
  if (q) and.push({ OR: [{ code: { contains: q, mode: 'insensitive' } }, { purpose: { contains: q, mode: 'insensitive' } }, { work_area: { contains: q, mode: 'insensitive' } }] });
  if (req.query.status) and.push({ status: { in: String(req.query.status).split(',') as 'DRAFT'[] } });
  if (req.query.department_id) and.push({ department_id: Number(req.query.department_id) });
  if (req.query.from) and.push({ doc_date: { gte: new Date(String(req.query.from)) } });
  if (req.query.to) and.push({ doc_date: { lte: new Date(String(req.query.to)) } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.stockIssue.findMany({
      where, skip, take, orderBy: [{ doc_date: 'desc' }, { id: 'desc' }],
      include: { department: { select: { name: true } }, requester: { select: { full_name: true } }, _count: { select: { lines: true } } },
    }),
    prisma.stockIssue.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('issues.view', 'issues.view_all'), async (req, res) => {
  const doc = await loadScoped(req, Number(req.params.id));
  const av = await getAvailability(prisma, doc.warehouse_id, doc.lines.map((l) => l.item_id), doc.status === 'APPROVED' ? doc.id : undefined);
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: doc.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  ok(res, {
    ...doc,
    lines: doc.lines.map((l) => ({ ...l, available: Number(av.get(l.item_id)?.available ?? 0) })),
    history: hist,
  });
});

r.post('/', requirePerm('issues.create'), async (req, res) => {
  const d = issueSchema.parse(req.body);
  if (d.client_request_id) {
    const exist = await prisma.stockIssue.findUnique({ where: { client_request_id: d.client_request_id } });
    if (exist) return ok(res, exist);
  }
  const { quotaWarning } = await validate(req, d);
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.ISSUE, d.doc_date);
    const { lines, ...head } = d;
    const created = await tx.stockIssue.create({
      data: {
        ...head, code, doc_date: toDateOnly(d.doc_date), requester_id: req.user!.id, quota_warning: quotaWarning,
        created_by: req.user!.id, updated_by: req.user!.id,
        lines: { create: lines.map((l, i) => ({ line_no: i + 1, item_id: l.item_id, qty_requested: l.qty_requested, note: l.note })) },
      },
    });
    await history(tx, ENTITY, created.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, created, undefined, d, tx);
    return created;
  });
  ok(res, doc);
});

r.put('/:id', requirePerm('issues.create'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadScoped(req, id);
  if (!['DRAFT', 'REJECTED'].includes(before.status)) throw ruleViolation('Chỉ sửa được phiếu Nháp hoặc Bị từ chối');
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa yêu cầu');
  const d = issueSchema.parse(req.body);
  const { quotaWarning } = await validate(req, d);
  await withTx(async (tx) => {
    await transition(tx, 'stockIssue', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.stockIssueItem.deleteMany({ where: { issue_id: id } });
    const { lines, client_request_id: _c, ...head } = d;
    await tx.stockIssue.update({
      where: { id },
      data: {
        ...head, doc_date: toDateOnly(d.doc_date), quota_warning: quotaWarning, status: 'DRAFT', updated_by: req.user!.id,
        lines: { create: lines.map((l, i) => ({ line_no: i + 1, item_id: l.item_id, qty_requested: l.qty_requested, note: l.note })) },
      },
    });
    await audit(req, 'UPDATE', ENTITY, before, before, d, tx);
  });
  ok(res, { id });
});

r.post('/:id/submit', requirePerm('issues.create'), async (req, res) => {
  const id = Number(req.params.id);
  const doc = await loadScoped(req, id);
  if (doc.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được gửi duyệt');
  await withTx(async (tx) => {
    await transition(tx, 'stockIssue', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, doc.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, doc, { status: doc.status }, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['issues.approve'], req.user!.id, { type: 'APPROVAL', title: `Yêu cầu cấp vật tư ${doc.code} chờ duyệt`, message: `${doc.department.name}: ${doc.purpose}`, link: `/issues/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

r.post('/:id/approve', requirePerm('issues.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    comment: zOptStr,
    lines: z.array(z.object({ id: z.coerce.number().int(), qty_approved: z.coerce.number().min(0) })).optional(),
  }).parse(req.body ?? {});
  const doc = await prisma.stockIssue.findUnique({ where: { id }, include: { lines: { include: { item: { select: { code: true, name: true } } } } } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by, doc.requester_id]);
  await withTx(async (tx) => {
    await lockItems(tx, doc.lines.map((l) => ({ warehouse_id: doc.warehouse_id, item_id: l.item_id })));
    await transition(tx, 'stockIssue', id, ['SUBMITTED'], { status: 'APPROVED', approved_by: req.user!.id, approved_at: new Date() });
    const av = await getAvailability(tx, doc.warehouse_id, doc.lines.map((l) => l.item_id), id);
    let total = D(0);
    for (const l of doc.lines) {
      const given = d.lines?.find((x) => x.id === l.id);
      const qty = D(given ? given.qty_approved : l.qty_requested);
      if (qty.gt(l.qty_requested)) throw badRequest(`Dòng ${l.line_no}: SL duyệt không được lớn hơn SL yêu cầu`);
      const a = av.get(l.item_id)!;
      if (qty.gt(a.available)) {
        throw ruleViolation(`Không đủ tồn khả dụng cho ${l.item.code} – ${l.item.name}: khả dụng ${a.available.toString()} (đã trừ giữ chỗ ${a.reserved.toString()}), duyệt ${qty.toString()}. Hãy giảm SL duyệt hoặc đề nghị mua hàng.`);
      }
      total = total.plus(qty);
      await tx.stockIssueItem.update({ where: { id: l.id }, data: { qty_approved: qty } });
    }
    if (total.lte(0)) throw badRequest('Tổng SL duyệt bằng 0 – hãy dùng chức năng Từ chối');
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'APPROVED', d.comment);
    await audit(req, 'APPROVE', ENTITY, doc, { status: 'SUBMITTED' }, { status: 'APPROVED', lines: d.lines }, tx);
    await notifyUsers(tx, [doc.requester_id], { type: 'INFO', title: `Yêu cầu ${doc.code} đã được duyệt`, link: `/issues/${id}` });
    await notifyPermission(tx, ['issues.issue'], req.user!.id, { type: 'TASK', title: `Phiếu ${doc.code} đã duyệt – chờ xuất kho`, link: `/issues/${id}` });
  });
  ok(res, { id, status: 'APPROVED' });
});

r.post('/:id/reject', requirePerm('issues.approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Bắt buộc nhập lý do từ chối') }).parse(req.body);
  const doc = await prisma.stockIssue.findUnique({ where: { id } });
  if (!doc) throw notFound();
  assertNotSelf(req, [doc.created_by, doc.requester_id], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'stockIssue', id, ['SUBMITTED'], { status: 'REJECTED', reject_reason: reason });
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, 'SUBMITTED', 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, doc, { status: 'SUBMITTED' }, { status: 'REJECTED', reason }, tx);
    await notifyUsers(tx, [doc.requester_id], { type: 'WARNING', title: `Yêu cầu ${doc.code} bị từ chối`, message: reason, link: `/issues/${id}` });
  });
  ok(res, { id, status: 'REJECTED' });
});

/** Thực hiện xuất kho – có thể lấy một dòng từ nhiều vị trí */
r.post('/:id/issue', requirePerm('issues.issue'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    receiver_name: z.string().trim().min(2, 'Bắt buộc nhập tên người nhận vật tư'),
    receiver_user_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    note: zOptStr,
    lines: z.array(z.object({
      id: z.coerce.number().int(),
      allocations: z.array(z.object({ location_id: z.coerce.number().int().positive(), qty: z.coerce.number().positive() })).default([]),
    })).min(1),
  }).parse(req.body);
  const doc = await prisma.stockIssue.findUnique({ where: { id }, include: { lines: { include: { item: { select: { code: true } } } } } });
  if (!doc) throw notFound();
  if (doc.status !== 'APPROVED') throw ruleViolation('Chỉ xuất kho phiếu đã được phê duyệt');
  await assertPeriodOpen(prisma, doc.doc_date);
  const locIds = d.lines.flatMap((l) => l.allocations.map((a) => a.location_id));
  const locs = await prisma.warehouseLocation.findMany({ where: { id: { in: locIds } } });
  if (locs.some((l) => l.warehouse_id !== doc.warehouse_id)) throw badRequest('Vị trí xuất không thuộc kho của phiếu');

  await withTx(async (tx) => {
    const now = new Date();
    await transition(tx, 'stockIssue', id, ['APPROVED'], { status: 'ISSUED', issued_by: req.user!.id, issued_at: now, receiver_name: d.receiver_name, receiver_user_id: d.receiver_user_id ?? null });
    const moves: MoveInput[] = [];
    let total = D(0);
    for (const l of doc.lines) {
      const given = d.lines.find((x) => x.id === l.id);
      const qty = (given?.allocations ?? []).reduce((s, a) => s.plus(a.qty), D(0));
      if (qty.gt(l.qty_approved ?? 0)) throw ruleViolation(`Dòng ${l.line_no} (${l.item.code}): SL thực xuất ${qty} vượt SL được duyệt ${l.qty_approved ?? 0}`);
      total = total.plus(qty);
      await tx.stockIssueItem.update({
        where: { id: l.id },
        data: { qty_issued: qty, location_id: given?.allocations.length === 1 ? given.allocations[0].location_id : given?.allocations[0]?.location_id ?? null },
      });
      for (const a of given?.allocations ?? []) {
        moves.push({
          warehouse_id: doc.warehouse_id, location_id: a.location_id, item_id: l.item_id, bucket: 'USABLE', direction: 'OUT', qty: a.qty,
          movement_type: 'ISSUE', doc_type: 'ISSUE', doc_id: doc.id, doc_code: doc.code, doc_line_id: l.id, doc_date: doc.doc_date,
          department_id: doc.department_id, note: doc.purpose,
        });
      }
    }
    if (total.lte(0)) throw badRequest('Chưa nhập số lượng thực xuất');
    await postMovements(tx, req.user!.id, moves, { excludeIssueId: id });
    await history(tx, ENTITY, id, 'ISSUE', req.user!.id, 'APPROVED', 'ISSUED', d.note);
    await audit(req, 'ISSUE_POST', ENTITY, doc, { status: 'APPROVED' }, { status: 'ISSUED', receiver: d.receiver_name, lines: d.lines }, tx);
    await notifyUsers(tx, [doc.requester_id, d.receiver_user_id], { type: 'TASK', title: `Vật tư phiếu ${doc.code} đã xuất – vui lòng xác nhận đã nhận`, link: `/issues/${id}` });
  });
  ok(res, { id, status: 'ISSUED' });
});

/** Người nhận xác nhận điện tử: gõ lại đúng họ tên của mình */
r.post('/:id/confirm', requirePerm('issues.confirm', 'issues.issue'), async (req, res) => {
  const id = Number(req.params.id);
  const { signature } = z.object({ signature: z.string().trim().min(2, 'Nhập họ tên để xác nhận') }).parse(req.body);
  const doc = await loadScoped(req, id);
  if (doc.status !== 'ISSUED') throw ruleViolation('Chỉ xác nhận phiếu đã xuất kho');
  const u = req.user!;
  const allowed = u.id === doc.requester_id || u.id === doc.receiver_user_id || (u.department_id && u.department_id === doc.department_id);
  if (!allowed) throw forbidden('Chỉ người yêu cầu / người nhận / thành viên bộ phận nhận được xác nhận');
  if (u.id === doc.issued_by) throw forbidden('Người xuất kho không được tự xác nhận thay người nhận');
  if (normalizeText(signature) !== normalizeText(u.full_name)) throw badRequest('Họ tên xác nhận không khớp với tài khoản đăng nhập');
  await withTx(async (tx) => {
    await transition(tx, 'stockIssue', id, ['ISSUED'], { status: 'RECEIVED', receive_confirmed_at: new Date(), receive_confirmed_by: u.id, receive_signature: signature });
    await history(tx, ENTITY, id, 'CONFIRM', u.id, 'ISSUED', 'RECEIVED', `Xác nhận bởi ${signature}`);
    await audit(req, 'CONFIRM_RECEIVE', ENTITY, doc, { status: 'ISSUED' }, { status: 'RECEIVED', signature }, tx);
  });
  ok(res, { id, status: 'RECEIVED' });
});

r.post('/:id/cancel', requirePerm('issues.create', 'issues.cancel'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Bắt buộc nhập lý do hủy') }).parse(req.body);
  const doc = await loadScoped(req, id);
  if (['ISSUED', 'RECEIVED', 'CANCELLED'].includes(doc.status)) throw ruleViolation('Phiếu đã xuất kho không được hủy. Dùng chức năng Hàng trả lại nếu cần.');
  const isOwner = doc.created_by === req.user!.id;
  if (!can(req, 'issues.cancel') && !(isOwner && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(doc.status))) {
    throw forbidden('Bạn chỉ được hủy yêu cầu của mình khi chưa được duyệt');
  }
  await withTx(async (tx) => {
    await transition(tx, 'stockIssue', id, ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, doc.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, doc, { status: doc.status }, { status: 'CANCELLED', reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
