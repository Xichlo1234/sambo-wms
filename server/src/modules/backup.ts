/**
 * SAO LƯU & KHÔI PHỤC (XIV)
 * - pg_dump định dạng custom (-Fc, nén) + SHA-256; kiểm tra toàn vẹn bằng pg_restore --list + so khớp SHA-256.
 * - Kèm bản nén thư mục file đính kèm (uploads).
 * - Khôi phục: bắt buộc gõ xác nhận, tự tạo bản sao lưu "trước khôi phục", chạy pg_restore trong 1 transaction.
 */
import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { z } from 'zod';
import { prisma } from '../db';
import { config } from '../config';
import { requirePerm, invalidateAuthCache } from '../lib/auth';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { ok } from '../lib/http';
import { invalidateSettings } from '../lib/settings';

const run = promisify(execFile);
const r = Router();
const BACKUP_DIR = path.join(config.storageDir, 'backups');
const UPLOAD_DIR = path.join(config.storageDir, 'uploads');
const bin = (n: string) => path.join(config.pgBinDir, n);

function dbUrl() {
  const u = new URL(config.databaseUrl);
  u.search = ''; // pg_dump không hiểu tham số ?schema= của Prisma
  return u.toString();
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

let running = false;

export async function createBackup(type: 'AUTO' | 'MANUAL', userId: number | null, note?: string) {
  if (running) throw badRequest('Đang có tiến trình sao lưu khác. Vui lòng đợi.');
  running = true;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // Tên file duy nhất (mili-giây + ngẫu nhiên) – không bao giờ ghi đè bản sao lưu cũ
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const name = `sambo_wms_${stamp}_${type.toLowerCase()}_${crypto.randomBytes(3).toString('hex')}`;
  if (fs.existsSync(path.join(BACKUP_DIR, `${name}.dump`))) { running = false; throw badRequest('Trùng tên bản sao lưu, thử lại'); }
  const log = await prisma.backupLog.create({ data: { file_name: `${name}.dump`, type, status: 'RUNNING', created_by: userId, message: note } });
  try {
    const file = path.join(BACKUP_DIR, `${name}.dump`);
    await run(bin('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', `--file=${file}`, dbUrl()], { maxBuffer: 1024 * 1024 * 50 });
    if (fs.existsSync(UPLOAD_DIR)) {
      await run('tar', ['-czf', path.join(BACKUP_DIR, `${name}.uploads.tar.gz`), '-C', UPLOAD_DIR, '.']);
    }
    const sha = await sha256File(file);
    fs.writeFileSync(file + '.sha256', `${sha}  ${path.basename(file)}\n`);
    const size = fs.statSync(file).size;
    const done = await prisma.backupLog.update({ where: { id: log.id }, data: { status: 'SUCCESS', size_bytes: BigInt(size), sha256: sha, finished_at: new Date() } });
    if (type === 'AUTO') await prune();
    return done;
  } catch (e) {
    await prisma.backupLog.update({ where: { id: log.id }, data: { status: 'FAILED', finished_at: new Date(), message: String((e as Error).message).slice(0, 1000) } });
    throw badRequest('Sao lưu thất bại: ' + String((e as Error).message).slice(0, 300));
  } finally {
    running = false;
  }
}

async function prune() {
  const old = await prisma.backupLog.findMany({ where: { type: 'AUTO', status: 'SUCCESS' }, orderBy: { id: 'desc' }, skip: config.backupKeep });
  for (const b of old) {
    for (const f of [b.file_name, b.file_name + '.sha256', b.file_name.replace('.dump', '.uploads.tar.gz')]) {
      const p = path.join(BACKUP_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await prisma.backupLog.update({ where: { id: b.id }, data: { status: 'PRUNED' } });
  }
}

export async function verifyBackup(id: number) {
  const b = await prisma.backupLog.findUnique({ where: { id } });
  if (!b || b.status !== 'SUCCESS') throw notFound('Không tìm thấy bản sao lưu hợp lệ');
  const file = path.join(BACKUP_DIR, b.file_name);
  if (!fs.existsSync(file)) throw notFound('File sao lưu không còn trên máy chủ');
  let okFlag = (await sha256File(file)) === b.sha256;
  let message = okFlag ? 'SHA-256 khớp' : 'SHA-256 KHÔNG khớp – file đã bị thay đổi/hỏng';
  if (okFlag) {
    try {
      const { stdout } = await run(bin('pg_restore'), ['--list', file], { maxBuffer: 1024 * 1024 * 50 });
      const tables = (stdout.match(/TABLE DATA/g) || []).length;
      okFlag = tables > 10;
      message += `; cấu trúc hợp lệ (${tables} bảng dữ liệu)`;
    } catch (e) {
      okFlag = false;
      message += '; pg_restore không đọc được: ' + String((e as Error).message).slice(0, 200);
    }
  }
  await prisma.backupLog.update({ where: { id }, data: { verified_at: new Date(), verify_ok: okFlag, message } });
  return { ok: okFlag, message };
}

r.get('/', requirePerm('backup.manage'), async (_req, res) => {
  const rows = await prisma.backupLog.findMany({ orderBy: { id: 'desc' }, take: 100 });
  ok(res, rows.map((b) => ({ ...b, size_bytes: b.size_bytes ? Number(b.size_bytes) : null, has_uploads: fs.existsSync(path.join(BACKUP_DIR, b.file_name.replace('.dump', '.uploads.tar.gz'))) })));
});

r.post('/', requirePerm('backup.manage'), async (req, res) => {
  const { note } = z.object({ note: z.string().max(300).optional() }).parse(req.body ?? {});
  const b = await createBackup('MANUAL', req.user!.id, note);
  await audit(req, 'BACKUP', 'backup', { id: b.id, code: b.file_name.slice(0, 60) });
  ok(res, { ...b, size_bytes: Number(b.size_bytes) });
});

r.post('/:id/verify', requirePerm('backup.manage'), async (req, res) => {
  const result = await verifyBackup(Number(req.params.id));
  await audit(req, 'BACKUP_VERIFY', 'backup', { id: Number(req.params.id) }, undefined, result);
  ok(res, result);
});

r.get('/:id/download', requirePerm('backup.manage'), async (req, res) => {
  const b = await prisma.backupLog.findUnique({ where: { id: Number(req.params.id) } });
  if (!b || b.status !== 'SUCCESS') throw notFound();
  const file = path.join(BACKUP_DIR, b.file_name);
  if (!fs.existsSync(file)) throw notFound('File sao lưu không còn trên máy chủ');
  await audit(req, 'BACKUP_DOWNLOAD', 'backup', { id: b.id, code: b.file_name.slice(0, 60) });
  res.download(file, b.file_name);
});

r.post('/:id/restore', requirePerm('backup.manage'), async (req, res) => {
  const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
  if (confirm !== 'KHOI PHUC') throw badRequest('Gõ chính xác "KHOI PHUC" để xác nhận khôi phục dữ liệu');
  const id = Number(req.params.id);
  const check = await verifyBackup(id);
  if (!check.ok) throw badRequest('Bản sao lưu không đạt kiểm tra toàn vẹn – không khôi phục. ' + check.message);
  const b = (await prisma.backupLog.findUnique({ where: { id } }))!;
  const safety = await createBackup('MANUAL', req.user!.id, `Tự động trước khi khôi phục bản #${id}`);
  await audit(req, 'RESTORE_START', 'backup', { id, code: b.file_name.slice(0, 60) }, undefined, { safety_backup: safety.file_name });
  const file = path.join(BACKUP_DIR, b.file_name);
  try {
    await run(bin('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', `--dbname=${dbUrl()}`, file], { maxBuffer: 1024 * 1024 * 50 });
  } catch (e) {
    throw badRequest('Khôi phục thất bại, dữ liệu giữ nguyên (transaction đã hoàn tác): ' + String((e as Error).message).slice(0, 300));
  }
  const up = path.join(BACKUP_DIR, b.file_name.replace('.dump', '.uploads.tar.gz'));
  if (fs.existsSync(up)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    await run('tar', ['-xzf', up, '-C', UPLOAD_DIR, '--skip-old-files']);
  }
  invalidateAuthCache();
  invalidateSettings();
  // Ghi lại nhật ký khôi phục & bản sao lưu an toàn vào DB vừa khôi phục
  await prisma.backupLog.create({ data: { file_name: safety.file_name, type: 'MANUAL', status: 'SUCCESS', size_bytes: safety.size_bytes, sha256: safety.sha256, finished_at: safety.finished_at, message: safety.message, created_by: req.user!.id } }).catch(() => undefined);
  await audit(req, 'RESTORE_DONE', 'backup', { id, code: b.file_name.slice(0, 60) }).catch(() => undefined);
  ok(res, { ok: true, safety_backup: safety.file_name, message: 'Đã khôi phục. Tất cả người dùng cần đăng nhập lại nếu phiên không còn hợp lệ.' });
});

export function scheduleBackups() {
  if (!config.backupCron) return;
  if (!cron.validate(config.backupCron)) {
    console.warn('[backup] BACKUP_CRON không hợp lệ:', config.backupCron);
    return;
  }
  cron.schedule(config.backupCron, () => {
    createBackup('AUTO', null).then((b) => verifyBackup(b.id)).catch((e) => console.error('[backup] tự động thất bại', e));
  });
  console.log('[backup] Lịch sao lưu tự động:', config.backupCron);
}

export default r;
