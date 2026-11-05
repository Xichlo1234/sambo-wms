import { prisma, type Db } from '../db';

/** Gửi thông báo tới mọi người dùng có một trong các quyền (trừ người thực hiện) */
export async function notifyPermission(db: Db, perms: string[], excludeUserId: number | null, n: { type: string; title: string; message?: string; link?: string }) {
  const users = await db.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      roles: { some: { role: { status: 'ACTIVE', permissions: { some: { permission: { code: { in: perms } } } } } } },
    },
    select: { id: true },
  });
  if (!users.length) return;
  await db.notification.createMany({ data: users.map((u) => ({ user_id: u.id, ...n })) });
}

export async function notifyUsers(db: Db, userIds: (number | null | undefined)[], n: { type: string; title: string; message?: string; link?: string }) {
  const ids = [...new Set(userIds.filter((x): x is number => !!x))];
  if (!ids.length) return;
  await (db ?? prisma).notification.createMany({ data: ids.map((id) => ({ user_id: id, ...n })) });
}
