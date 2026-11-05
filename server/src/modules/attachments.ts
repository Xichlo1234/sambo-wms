/**
 * TÀI LIỆU ĐÍNH KÈM – lưu file ngoài thư mục mã nguồn (STORAGE_DIR/uploads), tên file ngẫu nhiên,
 * kiểm tra phần mở rộng + MIME + chữ ký nhị phân (magic bytes), giới hạn dung lượng, phân quyền theo đối tượng.
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../db';
import { config } from '../config';
import { requirePerm, can } from '../lib/auth';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound, ruleViolation } from '../lib/errors';
import { ok } from '../lib/http';

const r = Router();
const UPLOAD_DIR = path.join(config.storageDir, 'uploads');

const ALLOWED: Record<string, { mimes: string[]; magic: (b: Buffer) => boolean }> = {
  '.pdf': { mimes: ['application/pdf'], magic: (b) => b.subarray(0, 4).toString() === '%PDF' },
  '.png': { mimes: ['image/png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mimes: ['image/jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  '.jpeg': { mimes: ['image/jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  '.xlsx': { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'application/zip'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  '.docx': { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream', 'application/zip'], magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
};

/** Đối tượng được đính kèm và quyền xem tương ứng */
const ENTITY_VIEW: Record<string, { perms: string[]; model: string; postedStatuses?: string[] }> = {
  item: { perms: ['items.view'], model: 'item' },
  supplier: { perms: ['suppliers.view'], model: 'supplier' },
  stock_receipt: { perms: ['receipts.view'], model: 'stockReceipt', postedStatuses: ['POSTED'] },
  stock_issue: { perms: ['issues.view', 'issues.view_all'], model: 'stockIssue', postedStatuses: ['ISSUED', 'RECEIVED'] },
  stock_transfer: { perms: ['transfers.view'], model: 'stockTransfer', postedStatuses: ['POSTED'] },
  stock_return: { perms: ['returns.view'], model: 'stockReturn', postedStatuses: ['POSTED'] },
  stock_adjustment: { perms: ['adjustments.view'], model: 'stockAdjustment', postedStatuses: ['POSTED'] },
  stocktake: { perms: ['stocktakes.view'], model: 'stocktake', postedStatuses: ['POSTED'] },
  chemical: { perms: ['chemicals.view'], model: 'chemical' },
  chemical_batch: { perms: ['chemicals.view'], model: 'chemicalBatch' },
  chemical_receipt: { perms: ['chemicals.view'], model: 'chemicalReceipt', postedStatuses: ['POSTED'] },
  chemical_issue: { perms: ['chemicals.view', 'chemicals.request'], model: 'chemicalIssue', postedStatuses: ['ISSUED', 'RECEIVED'] },
  chemical_stocktake: { perms: ['chemicals.view'], model: 'chemicalStocktake', postedStatuses: ['POSTED'] },
  chemical_adjustment: { perms: ['chemicals.view'], model: 'chemicalAdjustment', postedStatuses: ['POSTED'] },
  chemical_incident: { perms: ['chemicals.view'], model: 'chemicalIncident' },
  chemical_inspection: { perms: ['chemicals.view'], model: 'chemicalInspection' },
  purchase_request: { perms: ['purchase.view'], model: 'purchaseRequest' },
  supplier_quote: { perms: ['purchase.view'], model: 'supplierQuote' },
  purchase_order: { perms: ['purchase.view'], model: 'purchaseOrder' },
  supplier_complaint: { perms: ['suppliers.view'], model: 'supplierComplaint' },
};

/** Kiểm tra & lưu 1 file tải lên – dùng chung (đính kèm, hồ sơ SDS) */
export async function storeUpload(f: Express.Multer.File, meta: { entity_type: string; entity_id: number; category: string; note?: string }, userId: number) {
  const ext = path.extname(f.originalname).toLowerCase();
  const rule = ALLOWED[ext];
  if (!rule) throw badRequest(`File "${f.originalname}": chỉ chấp nhận PDF, XLSX, DOCX, JPG, PNG`);
  if (!rule.mimes.includes(f.mimetype) || !rule.magic(f.buffer)) throw badRequest(`File "${f.originalname}" không đúng định dạng thực tế (${ext}). Có thể file bị đổi đuôi.`);
  const now = new Date();
  const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const stored = `${sub}/${crypto.randomUUID()}${ext}`;
  fs.mkdirSync(path.join(UPLOAD_DIR, sub), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.buffer, { flag: 'wx' });
  return prisma.attachment.create({
    data: {
      ...meta, file_name: Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 255), stored_name: stored, mime_type: f.mimetype,
      size_bytes: f.size, sha256: crypto.createHash('sha256').update(f.buffer).digest('hex'), created_by: userId,
    },
  });
}
export { upload as attachmentUpload };

function assertView(req: Request, entityType: string) {
  const e = ENTITY_VIEW[entityType];
  if (!e) throw badRequest('Loại đối tượng đính kèm không hợp lệ');
  if (!e.perms.some((p) => can(req, p))) throw forbidden('Bạn không có quyền xem tài liệu của đối tượng này');
  return e;
}

async function loadEntity(model: string, id: number) {
  const delegate = (prisma as unknown as Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> }>)[model];
  return delegate.findUnique({ where: { id } });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 10 } });

r.get('/', async (req, res) => {
  const entityType = String(req.query.entity_type || '');
  const entityId = Number(req.query.entity_id);
  assertView(req, entityType);
  const rows = await prisma.attachment.findMany({ where: { entity_type: entityType, entity_id: entityId, deleted_at: null }, orderBy: { id: 'asc' } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.created_by) } }, select: { id: true, full_name: true } });
  ok(res, rows.map((x) => ({ ...x, stored_name: undefined, uploader: users.find((u) => u.id === x.created_by)?.full_name })));
});

r.post('/', requirePerm('attachments.upload'), upload.array('files', 10), async (req, res) => {
  const d = z.object({
    entity_type: z.string(), entity_id: z.coerce.number().int().positive(),
    category: z.enum(['INVOICE', 'DELIVERY_NOTE', 'PO', 'PHOTO', 'TECH_DOC', 'SDS', 'CERT', 'CONTRACT', 'REPORT', 'OTHER']).default('OTHER'),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  const e = assertView(req, d.entity_type);
  const entity = await loadEntity(e.model, d.entity_id);
  if (!entity) throw notFound('Không tìm thấy đối tượng để đính kèm');
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) throw badRequest('Chưa chọn file');
  const saved = [];
  for (const f of files) {
    const a = await storeUpload(f, { entity_type: d.entity_type, entity_id: d.entity_id, category: d.category, note: d.note }, req.user!.id);
    saved.push({ ...a, stored_name: undefined });
    await audit(req, 'UPLOAD', 'attachment', { id: a.id, code: a.file_name.slice(0, 60) }, undefined, { entity_type: d.entity_type, entity_id: d.entity_id, size: f.size });
  }
  ok(res, saved);
});

r.get('/:id/download', async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: Number(req.params.id) } });
  if (!a || a.deleted_at) throw notFound('Không tìm thấy tài liệu');
  assertView(req, a.entity_type);
  const full = path.join(UPLOAD_DIR, a.stored_name);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) throw notFound('File không còn trên máy chủ – liên hệ quản trị để khôi phục từ bản sao lưu');
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const inline = req.query.inline === '1' && (a.mime_type.startsWith('image/') || a.mime_type === 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
  fs.createReadStream(full).pipe(res);
});

r.delete('/:id', requirePerm('attachments.delete'), async (req, res) => {
  const a = await prisma.attachment.findUnique({ where: { id: Number(req.params.id) } });
  if (!a || a.deleted_at) throw notFound();
  const e = assertView(req, a.entity_type);
  if (e.postedStatuses) {
    const entity = await loadEntity(e.model, a.entity_id);
    if (entity && e.postedStatuses.includes(String(entity.status))) throw ruleViolation('Không được gỡ tài liệu của chứng từ đã ghi sổ');
  }
  await prisma.attachment.update({ where: { id: a.id }, data: { deleted_at: new Date(), deleted_by: req.user!.id } }); // xóa mềm, file vẫn giữ
  await audit(req, 'DELETE', 'attachment', { id: a.id, code: a.file_name.slice(0, 60) });
  ok(res, { ok: true });
});

export default r;
