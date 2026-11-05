import type { Request } from 'express';
import { prisma, type Db } from '../db';
import { clientIp } from './auth';

function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (k === 'password_hash' || k === 'token_hash') return undefined;
      if (typeof v === 'bigint') return v.toString();
      return v;
    }),
  );
}

export async function audit(
  req: Request | null,
  action: string,
  entityType: string,
  entity: { id?: number | string | null; code?: string | null } | null,
  before?: unknown,
  after?: unknown,
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      user_id: req?.user?.id ?? null,
      username: req?.user?.username ?? null,
      action,
      entity_type: entityType,
      entity_id: entity?.id != null ? String(entity.id) : null,
      entity_code: entity?.code ?? null,
      before_data: before === undefined ? undefined : (sanitize(before) as object),
      after_data: after === undefined ? undefined : (sanitize(after) as object),
      ip: req ? clientIp(req) : null,
      user_agent: req ? (req.headers['user-agent'] || '').slice(0, 300) : null,
      session_id: req?.user?.sessionId ?? null,
    },
  });
}

export async function history(
  db: Db, entityType: string, entityId: number, action: string, userId: number,
  fromStatus?: string | null, toStatus?: string | null, comment?: string | null,
) {
  await db.approvalHistory.create({
    data: { entity_type: entityType, entity_id: entityId, action, user_id: userId, from_status: fromStatus ?? null, to_status: toStatus ?? null, comment: comment ?? null },
  });
}
