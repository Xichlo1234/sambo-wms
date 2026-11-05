import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requirePerm, invalidateAuthCache } from '../lib/auth';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { ok, pageArgs, pageMeta, zOptStr } from '../lib/http';
import { passwordSchema } from './auth';
import { PERMISSIONS } from '../lib/permissions';

export const usersRouter = Router();
export const rolesRouter = Router();

const userSchema = z.object({
  username: z.string().trim().min(3, 'Tên đăng nhập tối thiểu 3 ký tự').max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Chỉ dùng chữ không dấu, số, dấu . _ -').transform((s) => s.toLowerCase()),
  full_name: z.string().trim().min(2, 'Nhập họ tên'),
  email: z.union([z.string().email('Email không hợp lệ'), z.literal('').transform(() => null), z.null()]).optional(),
  phone: zOptStr, position: zOptStr,
  department_id: z.union([z.coerce.number().int().positive(), z.literal('').transform(() => null), z.null()]).optional(),
  role_ids: z.array(z.coerce.number().int()).min(1, 'Chọn ít nhất 1 vai trò'),
});

const present = (u: { password_hash?: string } & Record<string, unknown>) => {
  const { password_hash: _p, ...rest } = u;
  return rest;
};

usersRouter.get('/', requirePerm('users.manage'), async (req, res) => {
  const { page, pageSize, skip, take } = pageArgs(req.query);
  const q = String(req.query.q || '');
  const where = {
    ...(q ? { OR: [{ username: { contains: q, mode: 'insensitive' as const } }, { full_name: { contains: q, mode: 'insensitive' as const } }] } : {}),
    ...(req.query.status ? { status: String(req.query.status) as 'ACTIVE' } : {}),
    ...(req.query.department_id ? { department_id: Number(req.query.department_id) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take, orderBy: { username: 'asc' }, include: { department: { select: { name: true } }, roles: { include: { role: { select: { id: true, name: true, code: true } } } } } }),
    prisma.user.count({ where }),
  ]);
  ok(res, rows.map(present), pageMeta(page, pageSize, total));
});

/** Danh sách rút gọn người dùng đang hoạt động (chọn người nhận, người phụ trách) */
usersRouter.get('/lookup', requirePerm('issues.issue', 'departments.manage', 'users.manage'), async (req, res) => {
  const rows = await prisma.user.findMany({
    where: { status: 'ACTIVE', ...(req.query.department_id ? { department_id: Number(req.query.department_id) } : {}) },
    select: { id: true, username: true, full_name: true, department_id: true }, orderBy: { full_name: 'asc' }, take: 1000,
  });
  ok(res, rows);
});

usersRouter.post('/', requirePerm('users.manage'), async (req, res) => {
  const d = userSchema.extend({ password: passwordSchema }).parse(req.body);
  const { role_ids, password, ...data } = d;
  const u = await prisma.user.create({
    data: { ...data, password_hash: await bcrypt.hash(password, 10), must_change_password: true, created_by: req.user!.id, updated_by: req.user!.id, roles: { create: role_ids.map((role_id) => ({ role_id, created_by: req.user!.id })) } },
  });
  await audit(req, 'CREATE', 'user', { id: u.id, code: u.username }, undefined, { ...data, role_ids });
  ok(res, present(u));
});

usersRouter.put('/:id', requirePerm('users.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  if (!before) throw notFound();
  const { role_ids, ...data } = userSchema.parse(req.body);
  if (id === req.user!.id) {
    const superRole = await prisma.role.findUnique({ where: { code: 'SUPER_ADMIN' } });
    if (superRole && before.roles.some((r) => r.role_id === superRole.id) && !role_ids.includes(superRole.id)) throw badRequest('Không thể tự gỡ vai trò Super Admin của chính mình');
  }
  const u = await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { user_id: id } });
    return tx.user.update({ where: { id }, data: { ...data, updated_by: req.user!.id, roles: { create: role_ids.map((role_id) => ({ role_id, created_by: req.user!.id })) } } });
  });
  invalidateAuthCache(id);
  await audit(req, 'UPDATE', 'user', { id, code: u.username }, present(before as never), { ...data, role_ids });
  ok(res, present(u));
});

usersRouter.patch('/:id/status', requirePerm('users.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body);
  if (id === req.user!.id) throw badRequest('Không thể tự khóa tài khoản của mình');
  const u = await prisma.user.update({ where: { id }, data: { status, updated_by: req.user!.id } });
  if (status === 'INACTIVE') await prisma.session.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
  invalidateAuthCache(id);
  await audit(req, status === 'ACTIVE' ? 'UNLOCK' : 'LOCK', 'user', { id, code: u.username });
  ok(res, present(u));
});

usersRouter.post('/:id/reset-password', requirePerm('users.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const { password } = z.object({ password: passwordSchema }).parse(req.body);
  const u = await prisma.user.update({ where: { id }, data: { password_hash: await bcrypt.hash(password, 10), must_change_password: true, failed_attempts: 0, locked_until: null } });
  await prisma.session.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
  invalidateAuthCache(id);
  await audit(req, 'RESET_PASSWORD', 'user', { id, code: u.username });
  ok(res, { ok: true });
});

// ---------------- Vai trò & quyền ----------------
rolesRouter.get('/', requirePerm('roles.manage', 'users.manage'), async (_req, res) => {
  const roles = await prisma.role.findMany({ orderBy: { id: 'asc' }, include: { permissions: { include: { permission: { select: { code: true } } } }, _count: { select: { users: true } } } });
  ok(res, roles.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.code) })));
});

rolesRouter.get('/permissions', requirePerm('roles.manage'), async (_req, res) => {
  ok(res, PERMISSIONS);
});

const roleSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/i, 'Mã vai trò chỉ gồm chữ, số, _').transform((s) => s.toUpperCase()),
  name: z.string().trim().min(2), description: zOptStr,
  permissions: z.array(z.string()),
});

async function setPerms(roleId: number, codes: string[]) {
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { role_id: roleId } }),
    prisma.rolePermission.createMany({ data: perms.map((p) => ({ role_id: roleId, permission_id: p.id })) }),
  ]);
}

rolesRouter.post('/', requirePerm('roles.manage'), async (req, res) => {
  const d = roleSchema.parse(req.body);
  const role = await prisma.role.create({ data: { code: d.code, name: d.name, description: d.description, created_by: req.user!.id } });
  await setPerms(role.id, d.permissions);
  await audit(req, 'CREATE', 'role', { id: role.id, code: role.code }, undefined, d);
  ok(res, role);
});

rolesRouter.put('/:id', requirePerm('roles.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
  if (!before) throw notFound();
  const d = roleSchema.parse(req.body);
  if (before.code === 'SUPER_ADMIN' && (d.code !== 'SUPER_ADMIN' || !d.permissions.includes('roles.manage') || !d.permissions.includes('users.manage'))) {
    throw badRequest('Vai trò Super Admin phải giữ quyền quản lý người dùng và phân quyền');
  }
  const role = await prisma.role.update({ where: { id }, data: { code: before.is_system ? before.code : d.code, name: d.name, description: d.description, updated_by: req.user!.id } });
  await setPerms(id, d.permissions);
  invalidateAuthCache();
  await audit(req, 'UPDATE_PERMISSIONS', 'role', { id, code: role.code }, { permissions: before.permissions.map((p) => p.permission.code) }, { permissions: d.permissions });
  ok(res, role);
});
