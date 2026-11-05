import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { config, SESSION_COOKIE } from '../config';
import { forbidden, unauthorized } from './errors';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  department_id: number | null;
  roles: string[];
  permissions: Set<string>;
  sessionId: string;
  must_change_password: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Cache phiên trong bộ nhớ (giảm lượt đọc DB mỗi request). Xóa cache khi đổi quyền / khóa user / đăng xuất. */
const CACHE_TTL_MS = 30_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;
const cache = new Map<string, { user: AuthUser; expiresAt: number; cachedAt: number; lastTouch: number }>();

export function invalidateAuthCache(userId?: number) {
  if (userId === undefined) return cache.clear();
  for (const [k, v] of cache) if (v.user.id === userId) cache.delete(k);
}

export async function loadAuthUser(userId: number, sessionId: string): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!u || u.status !== 'ACTIVE') return null;
  const perms = new Set<string>();
  const roles: string[] = [];
  for (const ur of u.roles) {
    if (ur.role.status !== 'ACTIVE') continue;
    roles.push(ur.role.code);
    for (const rp of ur.role.permissions) perms.add(rp.permission.code);
  }
  return {
    id: u.id, username: u.username, full_name: u.full_name, department_id: u.department_id,
    roles, permissions: perms, sessionId, must_change_password: u.must_change_password,
  };
}

export async function createSession(userId: number, req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  await prisma.session.create({
    data: {
      token_hash: hashToken(token), user_id: userId, expires_at: expires,
      ip: clientIp(req), user_agent: (req.headers['user-agent'] || '').slice(0, 300),
    },
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires, path: '/',
  });
}

export function clientIp(req: Request) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string') return cf.slice(0, 64);
  return (req.ip || '').slice(0, 64);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(unauthorized('Bạn chưa đăng nhập'));
  const th = hashToken(token);
  const now = Date.now();
  const hit = cache.get(th);
  if (hit && now - hit.cachedAt < CACHE_TTL_MS && hit.expiresAt > now) {
    req.user = hit.user;
    if (now - hit.lastTouch > TOUCH_INTERVAL_MS) {
      hit.lastTouch = now;
      prisma.session.update({ where: { token_hash: th }, data: { last_seen_at: new Date() } }).catch(() => undefined);
    }
    return next();
  }
  const s = await prisma.session.findUnique({ where: { token_hash: th } });
  if (!s || s.revoked_at || s.expires_at.getTime() <= now) {
    cache.delete(th);
    return next(unauthorized());
  }
  const user = await loadAuthUser(s.user_id, s.id);
  if (!user) return next(unauthorized('Tài khoản đã bị khóa hoặc không tồn tại'));
  const lastTouch = hit?.lastTouch ?? 0;
  cache.set(th, { user, expiresAt: s.expires_at.getTime(), cachedAt: now, lastTouch: now });
  if (now - lastTouch > TOUCH_INTERVAL_MS) {
    prisma.session.update({ where: { id: s.id }, data: { last_seen_at: new Date() } }).catch(() => undefined);
  }
  req.user = user;
  next();
}

/** Yêu cầu có ÍT NHẤT một trong các quyền */
export function requirePerm(...codes: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user;
    if (!u) return next(unauthorized());
    if (codes.some((c) => u.permissions.has(c))) return next();
    next(forbidden(`Bạn không có quyền: ${codes.join(' hoặc ')}`));
  };
}

export const can = (req: Request, code: string) => !!req.user?.permissions.has(code);

export function assertPerm(req: Request, code: string) {
  if (!can(req, code)) throw forbidden(`Bạn không có quyền: ${code}`);
}

/** Nguyên tắc 4 mắt: người lập không được tự phê duyệt */
export function assertNotSelf(req: Request, creatorIds: (number | null | undefined)[], action = 'phê duyệt') {
  if (creatorIds.some((id) => id && id === req.user!.id)) {
    throw forbidden(`Không được tự ${action} chứng từ do chính mình lập/yêu cầu (nguyên tắc kiểm soát 2 người).`);
  }
}
