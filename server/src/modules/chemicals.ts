/**
 * KHO HÓA CHẤT – Danh mục hóa chất, hồ sơ SDS/MSDS, yêu cầu lưu trữ, lô (batch), tồn kho theo lô, cảnh báo hạn sử dụng.
 * Nguyên tắc an toàn: hệ thống KHÔNG tự suy diễn đặc tính nguy hiểm; mọi thông tin an toàn do người có chuyên môn nhập
 * và xác nhận theo SDS. Sửa thông tin an toàn sẽ hủy trạng thái "đã xác nhận".
 */
import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, withTx } from '../db';
import { requirePerm, can } from '../lib/auth';
import { audit, history } from '../lib/audit';
import { badRequest, notFound, ruleViolation, AppError } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { normalizeText } from '../lib/text';
import { getSettings } from '../lib/settings';
import { storeUpload, attachmentUpload } from './attachments';
import { sdsStatus, SDS_LABEL, chemAvailability, batchBlockReasons, todayUTC, fefoSort } from '../services/chemicals';

export const chemicalsRouter = Router();
export const batchesRouter = Router();
export const chemSafetyRouter = Router();

const zOptInt = z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional();
const zOptDec = z.union([z.null(), z.literal('').transform(() => null), z.coerce.number()]).optional();
const GHS = ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'];

const chemicalSchema = z.object({
  code: z.string().trim().min(1, 'Bắt buộc nhập mã hóa chất').max(50).transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, 'Bắt buộc nhập tên hóa chất').max(250),
  trade_name: zOptStr, name_en: zOptStr, scientific_name: zOptStr,
  cas_number: z.union([z.string().trim().regex(/^\d{2,7}-\d{2}-\d$/, 'CAS Number dạng 1234-56-7'), z.literal('').transform(() => null), z.null()]).optional(),
  formula: zOptStr, concentration: zOptStr, chemical_group: zOptStr, manufacturer: zOptStr, supplier_id: zOptInt,
  unit_id: z.coerce.number({ invalid_type_error: 'Chọn đơn vị tính' }).int().positive('Chọn đơn vị tính'),
  packaging: zOptStr, physical_state: z.enum(['SOLID', 'LIQUID', 'GAS', 'OTHER']).default('OTHER'),
  hazard_level: zOptStr, ghs_classification: zOptStr, ghs_pictograms: z.array(z.enum(GHS as [string, ...string[]])).default([]),
  hazard_statements: zOptStr, precautionary_statements: zOptStr, storage_conditions: zOptStr,
  storage_temp_min: zOptDec, storage_temp_max: zOptDec, ventilation_req: zOptStr, fire_req: zOptStr, ppe_req: zOptStr,
  first_aid: zOptStr, spill_response: zOptStr,
  default_shelf_life_days: z.union([z.null(), z.literal('').transform(() => null), z.coerce.number().int().positive()]).optional(),
  is_controlled: z.boolean().default(false), min_stock: z.coerce.number().min(0).default(0), safety_notes: zOptStr, note: zOptStr,
}).refine((d) => d.storage_temp_min == null || d.storage_temp_max == null || d.storage_temp_max >= d.storage_temp_min, { message: 'Nhiệt độ tối đa phải ≥ tối thiểu', path: ['storage_temp_max'] });

/** Các trường an toàn – thay đổi sẽ hủy xác nhận chuyên môn */
const SAFETY_FIELDS = ['hazard_level', 'ghs_classification', 'ghs_pictograms', 'hazard_statements', 'precautionary_statements', 'storage_conditions', 'storage_temp_min', 'storage_temp_max', 'ventilation_req', 'fire_req', 'ppe_req', 'first_aid', 'spill_response', 'is_controlled'] as const;

function scopeChemSearch(q: string): Prisma.ChemicalWhereInput {
  return { OR: [{ code: { contains: q, mode: 'insensitive' } }, { search_text: { contains: normalizeText(q) } }, { cas_number: q }] };
}

// ---------------- Danh mục hóa chất ----------------
chemicalsRouter.get('/', requirePerm('chemicals.view', 'chemicals.request'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const and: Prisma.ChemicalWhereInput[] = [];
  const q = String(req.query.q || '').trim();
  if (q) and.push(scopeChemSearch(q));
  if (req.query.status) and.push({ status: String(req.query.status) as 'ACTIVE' });
  if (req.query.controlled === '1') and.push({ is_controlled: true });
  if (req.query.supplier_id) and.push({ supplier_id: Number(req.query.supplier_id) });
  if (req.query.group) and.push({ chemical_group: { contains: String(req.query.group), mode: 'insensitive' } });
  const where = and.length ? { AND: and } : {};
  if (req.query.all === '1') {
    const rows = await prisma.chemical.findMany({ where: { ...where, status: 'ACTIVE' }, select: { id: true, code: true, name: true, unit: { select: { code: true } }, is_controlled: true }, orderBy: { code: 'asc' }, take: 2000 });
    return ok(res, rows);
  }
  const [rows, total] = await Promise.all([
    prisma.chemical.findMany({ where, skip, take, orderBy: { code: 'asc' }, include: { unit: { select: { code: true } }, supplier: { select: { name: true } } } }),
    prisma.chemical.count({ where }),
  ]);
  const sds = await sdsStatus(prisma, rows.map((r) => r.id));
  ok(res, rows.map((r) => ({ ...r, sds_state: sds.get(r.id)?.state })), pageMeta(page, pageSize, total));
});

/** Tra cứu nhanh cho chứng từ, kèm tồn được phép xuất */
chemicalsRouter.get('/lookup', requirePerm('chemicals.view', 'chemicals.request'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const rows = await prisma.chemical.findMany({
    where: ids.length ? { id: { in: ids } } : { status: 'ACTIVE', ...(q ? scopeChemSearch(q) : {}) },
    select: { id: true, code: true, name: true, cas_number: true, concentration: true, is_controlled: true, unit: { select: { code: true } }, ghs_pictograms: true, default_shelf_life_days: true },
    orderBy: { code: 'asc' }, take: 30,
  });
  const wh = Number(req.query.warehouse_id) || 0;
  const av = wh ? await chemAvailability(prisma, wh, rows.map((r) => r.id)) : null;
  const sds = await sdsStatus(prisma, rows.map((r) => r.id));
  ok(res, rows.map((r) => ({ ...r, sds_state: sds.get(r.id)?.state, ...(av ? { available: Number(av.get(r.id)!.available), on_hand: Number(av.get(r.id)!.on_hand) } : {}) })));
});

chemicalsRouter.get('/:id', requirePerm('chemicals.view', 'chemicals.request'), async (req, res) => {
  const id = Number(req.params.id);
  const c = await prisma.chemical.findUnique({ where: { id }, include: { unit: true, supplier: { select: { id: true, code: true, name: true } } } });
  if (!c) throw notFound('Không tìm thấy hóa chất');
  const [docs, batches, rules, verifier] = await Promise.all([
    prisma.chemicalSafetyDocument.findMany({ where: { chemical_id: id }, orderBy: [{ status: 'asc' }, { id: 'desc' }] }),
    prisma.chemicalBatch.findMany({ where: { chemical_id: id, qty_on_hand: { gt: 0 } }, include: { location: { select: { code: true } }, warehouse: { select: { code: true } } }, orderBy: { expiry_date: 'asc' } }),
    prisma.chemicalStorageRequirement.findMany({ where: { OR: [{ chemical_a_id: id }, { chemical_b_id: id }], status: 'ACTIVE' } }),
    c.safety_verified_by ? prisma.user.findUnique({ where: { id: c.safety_verified_by }, select: { full_name: true } }) : null,
  ]);
  const others = await prisma.chemical.findMany({ where: { id: { in: rules.map((r) => (r.chemical_a_id === id ? r.chemical_b_id : r.chemical_a_id)) } }, select: { id: true, code: true, name: true } });
  const userIds = [...new Set(docs.map((d) => d.verified_by).filter(Boolean) as number[])];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true } });
  const sds = (await sdsStatus(prisma, [id])).get(id)!;
  const today = todayUTC();
  ok(res, {
    ...c, safety_verifier: verifier?.full_name ?? null, sds_state: sds.state, sds_label: SDS_LABEL[sds.state],
    documents: docs.map((d) => ({ ...d, verifier: users.find((u) => u.id === d.verified_by)?.full_name })),
    batches: fefoSort(batches).map((b) => ({ ...b, block_reasons: batchBlockReasons(b, today) })),
    storage_rules: rules.map((r) => ({ ...r, other: others.find((o) => o.id === (r.chemical_a_id === id ? r.chemical_b_id : r.chemical_a_id)) })),
  });
});

chemicalsRouter.post('/', requirePerm('chemicals.manage'), async (req, res) => {
  const d = chemicalSchema.parse(req.body);
  if (await prisma.chemical.findUnique({ where: { code: d.code } })) throw new AppError(409, 'DUPLICATE', `Mã hóa chất ${d.code} đã tồn tại`);
  if (d.cas_number) {
    const dup = await prisma.chemical.findFirst({ where: { cas_number: d.cas_number, concentration: d.concentration ?? null } });
    if (dup && !req.body.confirm_duplicate_cas) throw new AppError(409, 'SIMILAR_ITEMS', `Đã có hóa chất cùng CAS ${d.cas_number} và nồng độ: ${dup.code} – ${dup.name}. Xác nhận nếu là sản phẩm khác (tên thương mại / quy cách khác).`, [{ code: dup.code, name: dup.name, score: 1 }]);
  }
  const c = await prisma.chemical.create({ data: { ...d, search_text: normalizeText(d.name, d.trade_name, d.name_en, d.scientific_name, d.formula, d.cas_number), created_by: req.user!.id, updated_by: req.user!.id } });
  await audit(req, 'CREATE', 'chemical', c, undefined, c);
  ok(res, c);
});

chemicalsRouter.put('/:id', requirePerm('chemicals.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.chemical.findUnique({ where: { id } });
  if (!before) throw notFound();
  const d = chemicalSchema.parse(req.body);
  if (d.code !== before.code && (await prisma.chemicalBatch.count({ where: { chemical_id: id } }))) throw badRequest('Hóa chất đã có lô nhập kho – không được đổi mã');
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : Array.isArray(v) ? JSON.stringify([...v].sort()) : typeof v === 'object' || typeof v === 'number' ? String(Number(v)) : typeof v === 'boolean' ? String(v) : String(v));
  const changedSafety = SAFETY_FIELDS.some((k) => norm((before as Record<string, unknown>)[k]) !== norm((d as Record<string, unknown>)[k]));
  const c = await prisma.chemical.update({
    where: { id },
    data: {
      ...d, search_text: normalizeText(d.name, d.trade_name, d.name_en, d.scientific_name, d.formula, d.cas_number), updated_by: req.user!.id,
      ...(changedSafety ? { safety_verified_by: null, safety_verified_at: null } : {}),
    },
  });
  await audit(req, 'UPDATE', 'chemical', c, before, { ...d, safety_reverify_required: changedSafety });
  ok(res, { ...c, safety_reverify_required: changedSafety });
});

chemicalsRouter.patch('/:id/status', requirePerm('chemicals.manage'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
  const c = await prisma.chemical.update({ where: { id: Number(req.params.id) }, data: { status, updated_by: req.user!.id } });
  await audit(req, status === 'ACTIVE' ? 'UNLOCK' : 'LOCK', 'chemical', c);
  ok(res, c);
});

/** Người có chuyên môn xác nhận thông tin an toàn đã đối chiếu với SDS */
chemicalsRouter.post('/:id/verify-safety', requirePerm('chemicals.safety_verify'), async (req, res) => {
  const id = Number(req.params.id);
  const { note } = z.object({ note: zOptStr }).parse(req.body ?? {});
  const c = await prisma.chemical.findUnique({ where: { id } });
  if (!c) throw notFound();
  const sds = (await sdsStatus(prisma, [id])).get(id)!;
  if (sds.state === 'MISSING') throw ruleViolation('Chưa có SDS/MSDS – không thể xác nhận thông tin an toàn khi chưa có tài liệu căn cứ.');
  const u = await prisma.chemical.update({ where: { id }, data: { safety_verified_by: req.user!.id, safety_verified_at: new Date() } });
  await history(prisma, 'chemical', id, 'SAFETY_VERIFY', req.user!.id, null, null, note);
  await audit(req, 'SAFETY_VERIFY', 'chemical', c, undefined, { note, sds_doc: sds.doc_id });
  ok(res, u);
});

// ---------------- Hồ sơ an toàn: SDS/MSDS, tài liệu kỹ thuật, COA, hình bao bì, hướng dẫn sự cố ----------------
const DOC_TYPES = ['SDS', 'TECH', 'COA', 'PACKAGING', 'INCIDENT_GUIDE'] as const;
chemicalsRouter.post('/:id/documents', requirePerm('chemicals.manage', 'chemicals.safety_verify'), attachmentUpload.single('file'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({
    doc_type: z.enum(DOC_TYPES), title: z.string().trim().min(2, 'Nhập tiêu đề tài liệu'), version: zOptStr, language: zOptStr,
    issue_date: z.union([z.coerce.date(), z.literal('').transform(() => null)]).optional(), review_date: z.union([z.coerce.date(), z.literal('').transform(() => null)]).optional(), note: zOptStr,
  }).parse(req.body);
  const c = await prisma.chemical.findUnique({ where: { id } });
  if (!c) throw notFound();
  if (!req.file) throw badRequest('Chưa chọn file tài liệu');
  if (d.issue_date && d.review_date && d.review_date < d.issue_date) throw badRequest('Ngày rà soát phải sau ngày ban hành');
  const att = await storeUpload(req.file, { entity_type: 'chemical', entity_id: id, category: d.doc_type === 'SDS' ? 'SDS' : d.doc_type === 'COA' ? 'CERT' : d.doc_type === 'PACKAGING' ? 'PHOTO' : 'TECH_DOC', note: d.title }, req.user!.id);
  const doc = await withTx(async (tx) => {
    if (d.doc_type === 'SDS') await tx.chemicalSafetyDocument.updateMany({ where: { chemical_id: id, doc_type: 'SDS', status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    return tx.chemicalSafetyDocument.create({ data: { ...d, issue_date: d.issue_date ?? null, review_date: d.review_date ?? null, chemical_id: id, attachment_id: att.id, created_by: req.user!.id } });
  });
  await audit(req, 'UPLOAD_SAFETY_DOC', 'chemical', c, undefined, { doc_type: d.doc_type, title: d.title, version: d.version });
  ok(res, doc);
});

chemicalsRouter.post('/documents/:docId/verify', requirePerm('chemicals.safety_verify'), async (req, res) => {
  const doc = await prisma.chemicalSafetyDocument.findUnique({ where: { id: Number(req.params.docId) } });
  if (!doc) throw notFound();
  if (doc.status !== 'ACTIVE') throw ruleViolation('Tài liệu đã bị thay thế bởi phiên bản mới');
  const u = await prisma.chemicalSafetyDocument.update({ where: { id: doc.id }, data: { verified_by: req.user!.id, verified_at: new Date() } });
  await audit(req, 'VERIFY_SAFETY_DOC', 'chemical', { id: doc.chemical_id, code: doc.title.slice(0, 60) });
  ok(res, u);
});

// ---------------- Lô hóa chất & cảnh báo ----------------
function batchWhere(q: Request['query'], days: number[], longDays: number): Prisma.ChemicalBatchWhereInput {
  const and: Prisma.ChemicalBatchWhereInput[] = [];
  const today = todayUTC();
  if (q.only_stock !== '0') and.push({ qty_on_hand: { gt: 0 } });
  if (q.chemical_id) and.push({ chemical_id: Number(q.chemical_id) });
  if (q.supplier_id) and.push({ supplier_id: Number(q.supplier_id) });
  if (q.location_id) and.push({ location_id: Number(q.location_id) });
  if (q.warehouse_id) and.push({ warehouse_id: Number(q.warehouse_id) });
  if (q.batch_no) and.push({ OR: [{ batch_no: { contains: String(q.batch_no), mode: 'insensitive' } }, { internal_code: { contains: String(q.batch_no), mode: 'insensitive' } }] });
  if (q.q) and.push({ chemical: scopeChemSearch(String(q.q)) });
  if (q.expiry_from) and.push({ expiry_date: { gte: new Date(String(q.expiry_from)) } });
  if (q.expiry_to) and.push({ expiry_date: { lte: new Date(String(q.expiry_to)) } });
  if (q.qc_status) and.push({ qc_status: String(q.qc_status) as 'PASSED' });
  const plus = (n: number) => new Date(today.getTime() + n * 86400_000);
  switch (String(q.alert || '')) {
    case 'expired': and.push({ expiry_date: { lt: today } }); break;
    case 'exp1': and.push({ expiry_date: { gte: today, lte: plus(days[0]) } }); break;
    case 'exp2': and.push({ expiry_date: { gt: plus(days[0]), lte: plus(days[1] ?? days[0]) } }); break;
    case 'exp3': and.push({ expiry_date: { gt: plus(days[1] ?? days[0]), lte: plus(days[2] ?? days[1] ?? days[0]) } }); break;
    case 'long': and.push({ received_date: { lt: new Date(today.getTime() - longDays * 86400_000) } }); break;
    case 'abnormal': and.push({ abnormal: true }); break;
    case 'quarantine': and.push({ qc_status: { in: ['QUARANTINE', 'FAILED'] } }); break;
    case 'pending': and.push({ qc_status: 'PENDING' }); break;
  }
  return and.length ? { AND: and } : {};
}

batchesRouter.get('/', requirePerm('chemicals.view'), async (req, res) => {
  const s = await getSettings();
  const days = (s['chemical.expiry_alert_days'] as number[]) ?? [30, 60, 90];
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const where = batchWhere(req.query, days, Number(s['chemical.long_storage_days'] ?? 365));
  const [rows, total] = await Promise.all([
    prisma.chemicalBatch.findMany({
      where, skip, take, orderBy: [{ expiry_date: { sort: 'asc', nulls: 'last' } }, { received_date: 'asc' }],
      include: { chemical: { select: { id: true, code: true, name: true, unit: { select: { code: true } }, is_controlled: true } }, location: { select: { code: true } }, warehouse: { select: { code: true } }, supplier: { select: { name: true } } },
    }),
    prisma.chemicalBatch.count({ where }),
  ]);
  const today = todayUTC();
  ok(res, rows.map((b) => ({ ...b, days_to_expiry: b.expiry_date ? Math.round((b.expiry_date.getTime() - today.getTime()) / 86400_000) : null, block_reasons: batchBlockReasons(b, today) })), pageMeta(page, pageSize, total));
});

batchesRouter.get('/:id', requirePerm('chemicals.view'), async (req, res) => {
  const id = Number(req.params.id);
  const b = await prisma.chemicalBatch.findUnique({ where: { id }, include: { chemical: { include: { unit: true } }, location: true, warehouse: true, supplier: true, receipt: { select: { id: true, code: true } } } });
  if (!b) throw notFound('Không tìm thấy lô');
  const [movements, hist] = await Promise.all([
    prisma.chemicalMovement.findMany({ where: { batch_id: id }, orderBy: { id: 'asc' } }),
    prisma.approvalHistory.findMany({ where: { entity_type: 'chemical_batch', entity_id: id }, include: { user: { select: { full_name: true } } }, orderBy: { id: 'asc' } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(movements.map((m) => m.user_id))] } }, select: { id: true, full_name: true } });
  ok(res, { ...b, block_reasons: batchBlockReasons(b), movements: movements.map((m) => ({ ...m, id: m.id.toString(), user_name: users.find((u) => u.id === m.user_id)?.full_name })), history: hist.map((h) => ({ ...h, id: h.id.toString() })) });
});

/** Đổi trạng thái kiểm tra của lô: cách ly / giải phóng / không đạt */
batchesRouter.patch('/:id/status', requirePerm('chemicals.batch_status'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ qc_status: z.enum(['PASSED', 'QUARANTINE', 'FAILED']), note: z.string().trim().min(3, 'Bắt buộc ghi lý do / kết quả kiểm tra') }).parse(req.body);
  const b = await prisma.chemicalBatch.findUnique({ where: { id } });
  if (!b) throw notFound();
  if (d.qc_status === 'PASSED' && b.expiry_date && b.expiry_date < todayUTC()) throw ruleViolation('Lô đã hết hạn sử dụng – không được giải phóng cho sử dụng. Lập phiếu tiêu hủy.');
  if (b.qc_status === d.qc_status) throw badRequest('Lô đã ở trạng thái này');
  await withTx(async (tx) => {
    const r = await tx.chemicalBatch.updateMany({ where: { id, qc_status: b.qc_status }, data: { qc_status: d.qc_status, qc_note: d.note, updated_by: req.user!.id } });
    if (r.count !== 1) throw ruleViolation('Trạng thái lô vừa được người khác thay đổi – tải lại trang');
    await history(tx, 'chemical_batch', id, 'QC_STATUS', req.user!.id, b.qc_status, d.qc_status, d.note);
    await audit(req, 'BATCH_QC_STATUS', 'chemical_batch', { id, code: b.internal_code }, { qc_status: b.qc_status }, d, tx);
  });
  ok(res, { id, qc_status: d.qc_status });
});

batchesRouter.patch('/:id/abnormal', requirePerm('chemicals.batch_status', 'chemicals.inspection'), async (req, res) => {
  const id = Number(req.params.id);
  const d = z.object({ abnormal: z.boolean(), note: z.string().trim().min(3, 'Mô tả tình trạng bao bì / bảo quản') }).parse(req.body);
  const b = await prisma.chemicalBatch.update({ where: { id }, data: { abnormal: d.abnormal, abnormal_note: d.note, updated_by: req.user!.id } });
  await history(prisma, 'chemical_batch', id, d.abnormal ? 'ABNORMAL' : 'NORMAL', req.user!.id, null, null, d.note);
  await audit(req, 'BATCH_ABNORMAL', 'chemical_batch', { id, code: b.internal_code }, undefined, d);
  ok(res, b);
});

/** Tồn kho theo từng loại hóa chất (tổng hợp từ các lô) */
batchesRouter.get('/summary/by-chemical', requirePerm('chemicals.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const q = String(req.query.q || '').trim();
  const wh = Number(req.query.warehouse_id) || 0;
  const where: Prisma.ChemicalWhereInput = { ...(q ? scopeChemSearch(q) : {}), ...(req.query.status ? {} : { status: 'ACTIVE' }) };
  const [chems, total] = await Promise.all([
    prisma.chemical.findMany({ where, skip, take, orderBy: { code: 'asc' }, include: { unit: { select: { code: true } } } }),
    prisma.chemical.count({ where }),
  ]);
  const ids = chems.map((c) => c.id);
  const today = todayUTC();
  const batches = await prisma.chemicalBatch.findMany({ where: { chemical_id: { in: ids }, qty_on_hand: { gt: 0 }, ...(wh ? { warehouse_id: wh } : {}) } });
  const reserved = await prisma.$queryRaw<{ chemical_id: number; qty: number }[]>`
    SELECT l.chemical_id, SUM(l.qty_approved)::float AS qty FROM chemical_issue_items l JOIN chemical_issues i ON i.id = l.issue_id
    WHERE i.status = 'APPROVED' AND l.chemical_id IN (${Prisma.join(ids.length ? ids : [0])}) GROUP BY l.chemical_id`;
  const sds = await sdsStatus(prisma, ids);
  ok(res, chems.map((c) => {
    const bs = batches.filter((b) => b.chemical_id === c.id);
    const sum = (f: (b: typeof bs[0]) => boolean) => bs.filter(f).reduce((s, b) => s + Number(b.qty_on_hand), 0);
    const issuable = sum((b) => batchBlockReasons(b, today).length === 0);
    const res2 = reserved.find((r) => r.chemical_id === c.id)?.qty ?? 0;
    const nearest = fefoSort(bs.filter((b) => b.expiry_date))[0]?.expiry_date ?? null;
    return {
      id: c.id, code: c.code, name: c.name, unit: c.unit.code, is_controlled: c.is_controlled, min_stock: Number(c.min_stock), sds_state: sds.get(c.id)?.state,
      batch_count: bs.length, on_hand: sum(() => true), issuable, reserved: res2, available: issuable - res2,
      expired: sum((b) => !!b.expiry_date && b.expiry_date < today), quarantine: sum((b) => b.qc_status === 'QUARANTINE' || b.qc_status === 'FAILED'),
      pending: sum((b) => b.qc_status === 'PENDING'), nearest_expiry: nearest, below_min: Number(c.min_stock) > 0 && issuable < Number(c.min_stock),
    };
  }), pageMeta(page, pageSize, total));
});

/** Cảnh báo cho Dashboard hóa chất */
export async function chemicalAlerts() {
  const s = await getSettings();
  const days = (s['chemical.expiry_alert_days'] as number[]) ?? [30, 60, 90];
  const longDays = Number(s['chemical.long_storage_days'] ?? 365);
  const today = todayUTC();
  const plus = (n: number) => new Date(today.getTime() + n * 86400_000);
  const base = { qty_on_hand: { gt: 0 } };
  const [chemCount, batchCount, totalQty, expired, e1, e2, e3, longStored, abnormal, pending, quarantine, controlled] = await Promise.all([
    prisma.chemical.count({ where: { status: 'ACTIVE' } }),
    prisma.chemicalBatch.count({ where: base }),
    prisma.chemicalBatch.aggregate({ where: base, _sum: { qty_on_hand: true } }),
    prisma.chemicalBatch.count({ where: { ...base, expiry_date: { lt: today } } }),
    prisma.chemicalBatch.count({ where: { ...base, expiry_date: { gte: today, lte: plus(days[0]) } } }),
    prisma.chemicalBatch.count({ where: { ...base, expiry_date: { gt: plus(days[0]), lte: plus(days[1] ?? days[0]) } } }),
    prisma.chemicalBatch.count({ where: { ...base, expiry_date: { gt: plus(days[1] ?? days[0]), lte: plus(days[2] ?? days[1] ?? days[0]) } } }),
    prisma.chemicalBatch.count({ where: { ...base, received_date: { lt: new Date(today.getTime() - longDays * 86400_000) } } }),
    prisma.chemicalBatch.count({ where: { ...base, abnormal: true } }),
    prisma.chemicalBatch.count({ where: { ...base, qc_status: 'PENDING' } }),
    prisma.chemicalBatch.count({ where: { ...base, qc_status: { in: ['QUARANTINE', 'FAILED'] } } }),
    prisma.chemical.count({ where: { status: 'ACTIVE', is_controlled: true } }),
  ]);
  const chemIds = (await prisma.chemical.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })).map((c) => c.id);
  const sds = await sdsStatus(prisma, chemIds);
  const sdsMissing = [...sds.values()].filter((x) => x.state === 'MISSING' || x.state === 'EXPIRED').length;
  const sdsUnverified = [...sds.values()].filter((x) => x.state === 'UNVERIFIED').length;
  return { days, long_days: longDays, chemical_count: chemCount, batch_count: batchCount, total_qty: Number(totalQty._sum.qty_on_hand ?? 0), expired, exp1: e1, exp2: e2, exp3: e3, long_stored: longStored, abnormal, pending, quarantine, controlled, sds_missing: sdsMissing, sds_unverified: sdsUnverified };
}

batchesRouter.get('/summary/alerts', requirePerm('chemicals.view'), async (_req, res) => ok(res, await chemicalAlerts()));

// ---------------- An toàn: quy tắc lưu trữ, danh sách kiểm soát ----------------
chemSafetyRouter.get('/storage-rules', requirePerm('chemicals.view'), async (_req, res) => {
  const rules = await prisma.chemicalStorageRequirement.findMany({ orderBy: { id: 'desc' } });
  const chems = await prisma.chemical.findMany({ where: { id: { in: rules.flatMap((r) => [r.chemical_a_id, r.chemical_b_id]) } }, select: { id: true, code: true, name: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rules.map((r) => r.verified_by).filter(Boolean) as number[] } }, select: { id: true, full_name: true } });
  ok(res, rules.map((r) => ({ ...r, a: chems.find((c) => c.id === r.chemical_a_id), b: chems.find((c) => c.id === r.chemical_b_id), verifier: users.find((u) => u.id === r.verified_by)?.full_name })));
});

chemSafetyRouter.post('/storage-rules', requirePerm('chemicals.manage', 'chemicals.safety_verify'), async (req, res) => {
  const d = z.object({ chemical_a_id: z.coerce.number().int().positive(), chemical_b_id: z.coerce.number().int().positive(), description: z.string().trim().min(5, 'Mô tả yêu cầu lưu trữ theo SDS'), source_ref: z.string().trim().min(3, 'Ghi rõ căn cứ (mục SDS / tài liệu)') }).parse(req.body);
  if (d.chemical_a_id === d.chemical_b_id) throw badRequest('Chọn 2 hóa chất khác nhau');
  const [a, b] = d.chemical_a_id < d.chemical_b_id ? [d.chemical_a_id, d.chemical_b_id] : [d.chemical_b_id, d.chemical_a_id];
  const r = await prisma.chemicalStorageRequirement.create({ data: { chemical_a_id: a, chemical_b_id: b, description: d.description, source_ref: d.source_ref, created_by: req.user!.id } });
  await audit(req, 'CREATE', 'chemical_storage_rule', { id: r.id }, undefined, d);
  ok(res, r);
});

chemSafetyRouter.post('/storage-rules/:id/verify', requirePerm('chemicals.safety_verify'), async (req, res) => {
  const r = await prisma.chemicalStorageRequirement.findUnique({ where: { id: Number(req.params.id) } });
  if (!r) throw notFound();
  const u = await prisma.chemicalStorageRequirement.update({ where: { id: r.id }, data: { verified_by: req.user!.id, verified_at: new Date() } });
  await audit(req, 'VERIFY', 'chemical_storage_rule', { id: r.id });
  ok(res, u);
});

chemSafetyRouter.patch('/storage-rules/:id/status', requirePerm('chemicals.safety_verify'), async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
  const u = await prisma.chemicalStorageRequirement.update({ where: { id: Number(req.params.id) }, data: { status } });
  await audit(req, status === 'ACTIVE' ? 'UNLOCK' : 'LOCK', 'chemical_storage_rule', { id: u.id });
  ok(res, u);
});

export { can };
