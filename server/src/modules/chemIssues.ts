/**
 * XUẤT KHO HÓA CHẤT (6.4)
 * DRAFT → SUBMITTED → APPROVED (giữ chỗ) → [HSE xác nhận nếu có hóa chất kiểm soát đặc biệt] → ISSUED (xuất theo lô) → RECEIVED
 * Chặn xuất lô: hết hạn, cách ly, không đạt/chưa kiểm tra, hóa chất thiếu SDS hiệu lực (theo chính sách). Không có nút bỏ qua cảnh báo.
 * FEFO (cấu hình): bắt buộc lấy lô hạn gần nhất trước.
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
import { getSettings } from '../lib/settings';
import { normalizeText } from '../lib/text';
import { toDateOnly, assertPeriodOpen } from '../services/inventory';
import { chemicalWarehouse, chemicalPolicyBlocks, chemAvailability, lockChemicals, postChemMovements, batchBlockReasons, fefoSort, todayUTC } from '../services/chemicals';

const r = Router();
const ENTITY = 'chemical_issue';
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const schema = z.object({
  client_request_id: z.string().max(64).optional(),
  warehouse_id: z.coerce.number().int().positive('Chọn kho hóa chất'),
  doc_date: z.coerce.date(),
  department_id: z.coerce.number().int().positive('Chọn bộ phận sử dụng'),
  purpose: z.string().trim().min(5, 'Ghi rõ mục đích sử dụng'),
  work_area: z.string().trim().min(2, 'Ghi rõ khu vực sử dụng'),
  responsible_person: z.string().trim().min(2, 'Ghi rõ người chịu trách nhiệm'),
  note: zOptStr,
  lines: z.array(z.object({ chemical_id: z.coerce.number().int().positive('Chọn hóa chất'), qty_requested: z.coerce.number().positive('SL phải > 0'), note: zOptStr })).min(1),
});

const include = {
  warehouse: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  requester: { select: { id: true, full_name: true } },
  lines: { orderBy: { line_no: 'asc' }, include: { chemical: { select: { id: true, code: true, name: true, is_controlled: true, ppe_req: true, ghs_pictograms: true, unit: { select: { code: true } } } } } },
} satisfies Prisma.ChemicalIssueInclude;

function scope(req: Request): Prisma.ChemicalIssueWhereInput {
  if (['chemicals.issue', 'chemicals.issue_approve', 'chemicals.hse_confirm', 'chemicals.manage', 'chemicals.receipt_create', 'reports.view'].some((p) => can(req, p))) return {};
  return { OR: [{ requester_id: req.user!.id }, ...(req.user!.department_id ? [{ department_id: req.user!.department_id }] : [])] };
}

async function loadScoped(req: Request, id: number) {
  const d = await prisma.chemicalIssue.findFirst({ where: { id, ...scope(req) }, include });
  if (!d) throw notFound('Không tìm thấy phiếu hoặc bạn không có quyền xem');
  return d;
}

r.get('/', requirePerm('chemicals.view', 'chemicals.request'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.ChemicalIssueWhereInput[] = [scope(req)];
  if (req.query.q) and.push({ OR: [{ code: { contains: String(req.query.q), mode: 'insensitive' } }, { purpose: { contains: String(req.query.q), mode: 'insensitive' } }] });
  if (req.query.status) and.push({ status: String(req.query.status) as 'DRAFT' });
  if (req.query.from) and.push({ doc_date: { gte: new Date(String(req.query.from)) } });
  if (req.query.to) and.push({ doc_date: { lte: new Date(String(req.query.to)) } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.chemicalIssue.findMany({ where, skip, take, orderBy: { id: 'desc' }, include: { department: { select: { name: true } }, requester: { select: { full_name: true } }, _count: { select: { lines: true } } } }),
    prisma.chemicalIssue.count({ where }),
  ]);
  ok(res, rows, pageMeta(page, pageSize, total));
});

r.get('/:id', requirePerm('chemicals.view', 'chemicals.request'), async (req, res) => {
  const d = await loadScoped(req, Number(req.params.id));
  const av = await chemAvailability(prisma, d.warehouse_id, d.lines.map((l) => l.chemical_id), d.status === 'APPROVED' ? d.id : undefined);
  const { blocks } = await chemicalPolicyBlocks(prisma, d.lines.map((l) => l.chemical_id));
  const hist = await prisma.approvalHistory.findMany({ where: { entity_type: ENTITY, entity_id: d.id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } });
  const ids = [d.hse_confirmed_by, d.approved_by, d.issued_by].filter(Boolean) as number[];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true } });
  const nm = (id: number | null) => users.find((u) => u.id === id)?.full_name ?? null;
  ok(res, {
    ...d, hse_confirmer: nm(d.hse_confirmed_by), approver: nm(d.approved_by), issuer: nm(d.issued_by), history: hist,
    lines: d.lines.map((l) => ({ ...l, available: Number(av.get(l.chemical_id)!.available), on_hand: Number(av.get(l.chemical_id)!.on_hand), blocked_qty: Number(av.get(l.chemical_id)!.blocked), policy_blocks: blocks.get(l.chemical_id) ?? [] })),
  });
});

async function validate(req: Request, d: z.infer<typeof schema>) {
  await chemicalWarehouse(prisma, d.warehouse_id);
  const allDept = can(req, 'chemicals.issue') || can(req, 'chemicals.issue_approve');
  if (!allDept && d.department_id !== req.user!.department_id) throw forbidden('Chỉ được lập yêu cầu cho bộ phận của mình');
  const ids = d.lines.map((l) => l.chemical_id);
  if (new Set(ids).size !== ids.length) throw badRequest('Hóa chất bị lặp trong phiếu – gộp thành một dòng');
  const chems = await prisma.chemical.findMany({ where: { id: { in: ids } } });
  if (chems.some((c) => c.status !== 'ACTIVE') || chems.length !== ids.length) throw badRequest('Có hóa chất không tồn tại hoặc đã khóa');
  return chems.some((c) => c.is_controlled);
}

r.post('/', requirePerm('chemicals.request'), async (req, res) => {
  const d = schema.parse(req.body);
  if (d.client_request_id) {
    const e = await prisma.chemicalIssue.findUnique({ where: { client_request_id: d.client_request_id } });
    if (e) return ok(res, e);
  }
  const requiresHse = await validate(req, d);
  const doc = await withTx(async (tx) => {
    const code = await nextDocNo(tx, DOC_PREFIX.CHEM_ISSUE, d.doc_date);
    const { lines, ...head } = d;
    const c = await tx.chemicalIssue.create({ data: { ...head, code, doc_date: toDateOnly(d.doc_date), requester_id: req.user!.id, requires_hse: requiresHse, created_by: req.user!.id, updated_by: req.user!.id, lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } } });
    await history(tx, ENTITY, c.id, 'CREATE', req.user!.id, null, 'DRAFT');
    await audit(req, 'CREATE', ENTITY, c, undefined, d, tx);
    return c;
  });
  ok(res, doc);
});

r.put('/:id', requirePerm('chemicals.request'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await loadScoped(req, id);
  if (before.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được sửa');
  const d = schema.parse(req.body);
  const requiresHse = await validate(req, d);
  await withTx(async (tx) => {
    await transition(tx, 'chemicalIssue', id, ['DRAFT', 'REJECTED'], { updated_by: req.user!.id });
    await tx.chemicalIssueItem.deleteMany({ where: { issue_id: id } });
    const { lines, client_request_id: _c, ...head } = d;
    await tx.chemicalIssue.update({ where: { id }, data: { ...head, doc_date: toDateOnly(d.doc_date), requires_hse: requiresHse, status: 'DRAFT', lines: { create: lines.map((l, i) => ({ ...l, line_no: i + 1 })) } } });
    await audit(req, 'UPDATE', ENTITY, before, undefined, d, tx);
  });
  ok(res, { id });
});

r.post('/:id/submit', requirePerm('chemicals.request'), async (req, res) => {
  const id = Number(req.params.id);
  const d = await loadScoped(req, id);
  if (d.created_by !== req.user!.id) throw ruleViolation('Chỉ người lập được gửi duyệt');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalIssue', id, ['DRAFT', 'REJECTED'], { status: 'SUBMITTED', submitted_at: new Date(), reject_reason: null });
    await history(tx, ENTITY, id, 'SUBMIT', req.user!.id, d.status, 'SUBMITTED');
    await audit(req, 'SUBMIT', ENTITY, d, undefined, { status: 'SUBMITTED' }, tx);
    await notifyPermission(tx, ['chemicals.issue_approve'], req.user!.id, { type: 'APPROVAL', title: `Yêu cầu sử dụng hóa chất ${d.code} chờ duyệt`, message: d.purpose, link: `/chem-issues/${id}` });
    if (d.requires_hse) await notifyPermission(tx, ['chemicals.hse_confirm'], req.user!.id, { type: 'APPROVAL', title: `Hóa chất kiểm soát đặc biệt – phiếu ${d.code} cần HSE xác nhận`, link: `/chem-issues/${id}` });
  });
  ok(res, { id, status: 'SUBMITTED' });
});

r.post('/:id/approve', requirePerm('chemicals.issue_approve'), async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({ comment: zOptStr, lines: z.array(z.object({ id: z.coerce.number(), qty_approved: z.coerce.number().min(0) })).optional() }).parse(req.body ?? {});
  const d = await prisma.chemicalIssue.findUnique({ where: { id }, include: { lines: { include: { chemical: true } } } });
  if (!d) throw notFound();
  assertNotSelf(req, [d.created_by, d.requester_id]);
  const { blocks } = await chemicalPolicyBlocks(prisma, d.lines.map((l) => l.chemical_id));
  const policy = d.lines.flatMap((l) => (blocks.get(l.chemical_id) ?? []).map((x) => `${l.chemical.code}: ${x}`));
  if (policy.length) throw ruleViolation('Không đủ điều kiện an toàn để cấp:\n• ' + policy.join('\n• '));
  await withTx(async (tx) => {
    await lockChemicals(tx, d.lines.map((l) => ({ warehouse_id: d.warehouse_id, chemical_id: l.chemical_id })));
    await transition(tx, 'chemicalIssue', id, ['SUBMITTED'], { status: 'APPROVED', approved_by: req.user!.id, approved_at: new Date() });
    const av = await chemAvailability(tx, d.warehouse_id, d.lines.map((l) => l.chemical_id), id);
    let total = D(0);
    for (const l of d.lines) {
      const q = D(b.lines?.find((x) => x.id === l.id)?.qty_approved ?? l.qty_requested);
      if (q.gt(l.qty_requested)) throw badRequest(`${l.chemical.code}: SL duyệt không được lớn hơn SL yêu cầu`);
      const a = av.get(l.chemical_id)!;
      if (q.gt(a.available)) throw ruleViolation(`${l.chemical.code} – ${l.chemical.name}: tồn được phép xuất chỉ còn ${a.available.toString()} (đã loại lô hết hạn/cách ly/không đạt ${a.blocked.toString()}, giữ chỗ ${a.reserved.toString()}).`);
      total = total.plus(q);
      await tx.chemicalIssueItem.update({ where: { id: l.id }, data: { qty_approved: q } });
    }
    if (total.lte(0)) throw badRequest('Tổng SL duyệt bằng 0 – hãy Từ chối');
    await history(tx, ENTITY, id, 'APPROVE', req.user!.id, 'SUBMITTED', 'APPROVED', b.comment);
    await audit(req, 'APPROVE', ENTITY, d, undefined, b, tx);
    await notifyUsers(tx, [d.requester_id], { type: 'INFO', title: `Yêu cầu hóa chất ${d.code} đã được duyệt`, link: `/chem-issues/${id}` });
    await notifyPermission(tx, ['chemicals.issue'], req.user!.id, { type: 'TASK', title: `Phiếu hóa chất ${d.code} chờ xuất kho${d.requires_hse && !d.hse_confirmed_at ? ' (chờ HSE xác nhận)' : ''}`, link: `/chem-issues/${id}` });
  });
  ok(res, { id, status: 'APPROVED' });
});

/** HSE xác nhận yêu cầu an toàn cho hóa chất kiểm soát đặc biệt */
r.post('/:id/hse-confirm', requirePerm('chemicals.hse_confirm'), async (req, res) => {
  const id = Number(req.params.id);
  const { note } = z.object({ note: z.string().trim().min(3, 'Ghi nội dung xác nhận / điều kiện an toàn') }).parse(req.body);
  const d = await prisma.chemicalIssue.findUnique({ where: { id } });
  if (!d) throw notFound();
  if (!d.requires_hse) throw badRequest('Phiếu không có hóa chất kiểm soát đặc biệt');
  if (!['SUBMITTED', 'APPROVED'].includes(d.status)) throw ruleViolation('Chỉ xác nhận phiếu đang chờ duyệt hoặc đã duyệt');
  if (d.hse_confirmed_at) throw ruleViolation('Phiếu đã được HSE xác nhận');
  assertNotSelf(req, [d.created_by, d.requester_id], 'xác nhận an toàn');
  await prisma.chemicalIssue.update({ where: { id }, data: { hse_confirmed_by: req.user!.id, hse_confirmed_at: new Date(), hse_note: note } });
  await history(prisma, ENTITY, id, 'HSE_CONFIRM', req.user!.id, null, null, note);
  await audit(req, 'HSE_CONFIRM', ENTITY, d, undefined, { note });
  ok(res, { id });
});

r.post('/:id/reject', requirePerm('chemicals.issue_approve', 'chemicals.hse_confirm'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const d = await prisma.chemicalIssue.findUnique({ where: { id } });
  if (!d) throw notFound();
  assertNotSelf(req, [d.created_by, d.requester_id], 'từ chối');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalIssue', id, ['SUBMITTED', 'APPROVED'], { status: 'REJECTED', reject_reason: reason });
    await history(tx, ENTITY, id, 'REJECT', req.user!.id, d.status, 'REJECTED', reason);
    await audit(req, 'REJECT', ENTITY, d, undefined, { reason }, tx);
    await notifyUsers(tx, [d.requester_id], { type: 'WARNING', title: `Yêu cầu hóa chất ${d.code} bị từ chối`, message: reason, link: `/chem-issues/${id}` });
  });
  ok(res, { id, status: 'REJECTED' });
});

/** Gợi ý phân bổ lô theo FEFO + danh sách lô bị chặn kèm lý do */
r.get('/:id/allocation', requirePerm('chemicals.issue'), async (req, res) => {
  const d = await prisma.chemicalIssue.findUnique({ where: { id: Number(req.params.id) }, include: { lines: true } });
  if (!d) throw notFound();
  const today = todayUTC();
  const batches = await prisma.chemicalBatch.findMany({ where: { warehouse_id: d.warehouse_id, chemical_id: { in: d.lines.map((l) => l.chemical_id) }, qty_on_hand: { gt: 0 } }, include: { location: { select: { code: true } } } });
  const fefo = Boolean((await getSettings())['chemical.fefo']);
  ok(res, {
    fefo,
    lines: d.lines.map((l) => {
      const list = fefoSort(batches.filter((b) => b.chemical_id === l.chemical_id)).map((b) => ({ id: b.id, internal_code: b.internal_code, batch_no: b.batch_no, location: b.location.code, expiry_date: b.expiry_date, qty_on_hand: Number(b.qty_on_hand), qc_status: b.qc_status, abnormal: b.abnormal, block_reasons: batchBlockReasons(b, today) }));
      let need = Number(l.qty_approved ?? 0);
      const suggest = [];
      for (const b of list.filter((x) => !x.block_reasons.length)) { if (need <= 0) break; const q = Math.min(need, b.qty_on_hand); suggest.push({ batch_id: b.id, qty: q }); need -= q; }
      return { id: l.id, chemical_id: l.chemical_id, qty_approved: Number(l.qty_approved ?? 0), batches: list, suggest, shortage: Math.max(0, need) };
    }),
  });
});

r.post('/:id/issue', requirePerm('chemicals.issue'), async (req, res) => {
  const id = Number(req.params.id);
  const b = z.object({
    receiver_name: z.string().trim().min(2, 'Nhập người nhận'), receiver_user_id: z.union([z.coerce.number().int().positive(), z.null()]).optional(), note: zOptStr,
    lines: z.array(z.object({ id: z.coerce.number(), allocations: z.array(z.object({ batch_id: z.coerce.number().int().positive(), qty: z.coerce.number().positive() })).default([]) })).min(1),
  }).parse(req.body);
  const d = await prisma.chemicalIssue.findUnique({ where: { id }, include: { lines: { include: { chemical: true } } } });
  if (!d) throw notFound();
  if (d.status !== 'APPROVED') throw ruleViolation('Chỉ xuất phiếu đã được phê duyệt');
  if (d.requires_hse && !d.hse_confirmed_at) throw ruleViolation('Phiếu có hóa chất kiểm soát đặc biệt – phải được HSE xác nhận an toàn trước khi xuất.');
  await assertPeriodOpen(prisma, d.doc_date);
  const { blocks } = await chemicalPolicyBlocks(prisma, d.lines.map((l) => l.chemical_id));
  const fefo = Boolean((await getSettings())['chemical.fefo']);
  const today = todayUTC();
  await withTx(async (tx) => {
    await lockChemicals(tx, d.lines.map((l) => ({ warehouse_id: d.warehouse_id, chemical_id: l.chemical_id })));
    await transition(tx, 'chemicalIssue', id, ['APPROVED'], { status: 'ISSUED', issued_by: req.user!.id, issued_at: new Date(), receiver_name: b.receiver_name, receiver_user_id: b.receiver_user_id ?? null });
    const batches = await tx.chemicalBatch.findMany({ where: { warehouse_id: d.warehouse_id, chemical_id: { in: d.lines.map((l) => l.chemical_id) } } });
    const moves = [];
    let total = D(0);
    for (const l of d.lines) {
      const allocs = b.lines.find((x) => x.id === l.id)?.allocations ?? [];
      const qty = allocs.reduce((s, a) => s.plus(a.qty), D(0));
      if (qty.gt(l.qty_approved ?? 0)) throw ruleViolation(`${l.chemical.code}: SL xuất ${qty} vượt SL duyệt ${l.qty_approved}`);
      if (qty.gt(0) && (blocks.get(l.chemical_id) ?? []).length) throw ruleViolation(`${l.chemical.code}: ${blocks.get(l.chemical_id)!.join('; ')} – không được xuất`);
      const detail = [];
      for (const a of allocs) {
        const bt = batches.find((x) => x.id === a.batch_id);
        if (!bt || bt.chemical_id !== l.chemical_id) throw badRequest(`${l.chemical.code}: lô không thuộc hóa chất / kho của phiếu`);
        const reasons = batchBlockReasons(bt, today);
        if (reasons.length) throw ruleViolation(`Lô ${bt.internal_code} (mã lô NSX ${bt.batch_no}) bị chặn xuất: ${reasons.join(', ')}.`);
        detail.push({ batch_id: bt.id, internal_code: bt.internal_code, batch_no: bt.batch_no, expiry_date: bt.expiry_date, qty: a.qty });
        moves.push({ batch_id: bt.id, direction: 'OUT' as const, qty: a.qty, movement_type: 'ISSUE' as const, doc_type: 'CHEM_ISSUE', doc_id: d.id, doc_code: d.code, doc_date: d.doc_date, department_id: d.department_id, note: d.purpose });
      }
      if (fefo && allocs.length) {
        // FEFO: mọi lô đủ điều kiện có hạn sớm hơn lô được chọn muộn nhất phải được lấy hết
        const eligible = fefoSort(batches.filter((x) => x.chemical_id === l.chemical_id && x.qty_on_hand.gt(0) && !batchBlockReasons(x, today).length));
        const chosen = new Map(allocs.map((a) => [a.batch_id, D(a.qty)]));
        const lastIdx = Math.max(...allocs.map((a) => eligible.findIndex((x) => x.id === a.batch_id)));
        for (let i = 0; i < lastIdx; i++) {
          const e = eligible[i];
          if (!(chosen.get(e.id) ?? D(0)).gte(e.qty_on_hand)) throw ruleViolation(`${l.chemical.code}: vi phạm nguyên tắc FEFO – phải xuất hết lô ${e.internal_code} (HSD ${e.expiry_date?.toISOString().slice(0, 10) ?? 'không có'}) trước lô có hạn muộn hơn.`);
        }
      }
      total = total.plus(qty);
      await tx.chemicalIssueItem.update({ where: { id: l.id }, data: { qty_issued: qty, batch_detail: detail as unknown as Prisma.InputJsonValue } });
    }
    if (total.lte(0)) throw badRequest('Chưa chọn lô và số lượng xuất');
    await postChemMovements(tx, req.user!.id, moves);
    await history(tx, ENTITY, id, 'ISSUE', req.user!.id, 'APPROVED', 'ISSUED', b.note);
    await audit(req, 'ISSUE_POST', ENTITY, d, undefined, b, tx);
    await notifyUsers(tx, [d.requester_id, b.receiver_user_id], { type: 'TASK', title: `Hóa chất phiếu ${d.code} đã xuất – vui lòng xác nhận đã nhận`, link: `/chem-issues/${id}` });
  });
  ok(res, { id, status: 'ISSUED' });
});

r.post('/:id/confirm', requirePerm('chemicals.request', 'chemicals.issue'), async (req, res) => {
  const id = Number(req.params.id);
  const { signature } = z.object({ signature: z.string().trim().min(2) }).parse(req.body);
  const d = await loadScoped(req, id);
  if (d.status !== 'ISSUED') throw ruleViolation('Chỉ xác nhận phiếu đã xuất');
  const u = req.user!;
  if (!(u.id === d.requester_id || u.id === d.receiver_user_id || (u.department_id && u.department_id === d.department_id))) throw forbidden('Chỉ người yêu cầu / người nhận / bộ phận sử dụng được xác nhận');
  if (u.id === d.issued_by) throw forbidden('Người xuất kho không được xác nhận thay người nhận');
  if (normalizeText(signature) !== normalizeText(u.full_name)) throw badRequest('Họ tên xác nhận không khớp với tài khoản đăng nhập');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalIssue', id, ['ISSUED'], { status: 'RECEIVED', receive_confirmed_at: new Date(), receive_signature: signature });
    await history(tx, ENTITY, id, 'CONFIRM', u.id, 'ISSUED', 'RECEIVED', signature);
    await audit(req, 'CONFIRM_RECEIVE', ENTITY, d, undefined, { signature }, tx);
  });
  ok(res, { id, status: 'RECEIVED' });
});

r.post('/:id/cancel', requirePerm('chemicals.request', 'chemicals.issue_approve'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Nhập lý do') }).parse(req.body);
  const d = await loadScoped(req, id);
  if (!can(req, 'chemicals.issue_approve') && !(d.created_by === req.user!.id && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(d.status))) throw forbidden('Bạn chỉ hủy được yêu cầu của mình khi chưa duyệt');
  await withTx(async (tx) => {
    await transition(tx, 'chemicalIssue', id, ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'], { status: 'CANCELLED', cancel_reason: reason, cancelled_by: req.user!.id, cancelled_at: new Date() });
    await history(tx, ENTITY, id, 'CANCEL', req.user!.id, d.status, 'CANCELLED', reason);
    await audit(req, 'CANCEL', ENTITY, d, undefined, { reason }, tx);
  });
  ok(res, { id, status: 'CANCELLED' });
});

export default r;
