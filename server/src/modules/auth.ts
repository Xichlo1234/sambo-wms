import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { authenticate, createSession, hashToken, invalidateAuthCache, clientIp } from '../lib/auth';
import { audit } from '../lib/audit';
import { badRequest, unauthorized } from '../lib/errors';
import { ok } from '../lib/http';
import { SESSION_COOKIE } from '../config';

const r = Router();
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const passwordSchema = z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .regex(/[A-Za-z]/, 'Mật khẩu phải có chữ cái').regex(/[0-9]/, 'Mật khẩu phải có chữ số');

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' } } });

r.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(1, 'Nhập tên đăng nhập'), password: z.string().min(1, 'Nhập mật khẩu') }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  const fail = async (msg = 'Tên đăng nhập hoặc mật khẩu không đúng') => {
    await prisma.auditLog.create({ data: { action: 'LOGIN_FAILED', entity_type: 'auth', entity_code: username.slice(0, 60), ip: clientIp(req), user_agent: (req.headers['user-agent'] || '').slice(0, 300) } });
    throw unauthorized(msg);
  };
  if (!u) return fail();
  if (u.status !== 'ACTIVE') return fail('Tài khoản đã bị khóa. Liên hệ quản trị viên.');
  if (u.locked_until && u.locked_until > new Date()) return fail(`Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ${Math.ceil((u.locked_until.getTime() - Date.now()) / 60000)} phút.`);
  if (!(await bcrypt.compare(password, u.password_hash))) {
    const n = u.failed_attempts + 1;
    await prisma.user.update({ where: { id: u.id }, data: { failed_attempts: n >= MAX_FAILED ? 0 : n, locked_until: n >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
    return fail(n >= MAX_FAILED ? `Sai mật khẩu ${MAX_FAILED} lần – tài khoản bị tạm khóa ${LOCK_MINUTES} phút.` : undefined);
  }
  await prisma.user.update({ where: { id: u.id }, data: { failed_attempts: 0, locked_until: null, last_login_at: new Date() } });
  await createSession(u.id, req, res);
  req.user = { id: u.id, username: u.username } as never;
  await audit(req, 'LOGIN', 'auth', { id: u.id, code: u.username });
  ok(res, { id: u.id, must_change_password: u.must_change_password });
});

r.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const s = await prisma.session.findUnique({ where: { token_hash: hashToken(token) } });
    if (s && !s.revoked_at) {
      await prisma.session.update({ where: { id: s.id }, data: { revoked_at: new Date() } });
      invalidateAuthCache(s.user_id);
    }
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  ok(res, { ok: true });
});

r.get('/me', authenticate, async (req, res) => {
  const u = req.user!;
  const user = await prisma.user.findUnique({ where: { id: u.id }, include: { department: { select: { id: true, code: true, name: true } } } });
  ok(res, {
    id: u.id, username: u.username, full_name: u.full_name, department: user?.department ?? null, email: user?.email,
    roles: u.roles, permissions: [...u.permissions], must_change_password: user?.must_change_password ?? false,
  });
});

r.post('/change-password', authenticate, async (req, res) => {
  const d = z.object({ current_password: z.string().min(1, 'Nhập mật khẩu hiện tại'), new_password: passwordSchema }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!u || !(await bcrypt.compare(d.current_password, u.password_hash))) throw badRequest('Mật khẩu hiện tại không đúng');
  if (d.current_password === d.new_password) throw badRequest('Mật khẩu mới phải khác mật khẩu hiện tại');
  await prisma.user.update({ where: { id: u.id }, data: { password_hash: await bcrypt.hash(d.new_password, 10), must_change_password: false } });
  // Thu hồi các phiên khác
  await prisma.session.updateMany({ where: { user_id: u.id, revoked_at: null, NOT: { id: req.user!.sessionId } }, data: { revoked_at: new Date() } });
  invalidateAuthCache(u.id);
  await audit(req, 'CHANGE_PASSWORD', 'user', { id: u.id, code: u.username });
  ok(res, { ok: true });
});

export default r;
