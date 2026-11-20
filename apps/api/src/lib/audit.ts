import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

type Db = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

export type AuditAction =
  | 'user.registered'
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'device.pairing_code_created'
  | 'device.paired'
  | 'device.revoked'
  | 'device.secret_rotation_requested'
  | 'device.secret_rotated'
  | 'command.created';

export interface AuditEntry {
  userId: string;
  actorType: 'user' | 'device' | 'system';
  actorId?: string | null;
  action: AuditAction;
  targetType: 'user' | 'device' | 'pairing_code' | 'command';
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Append-only. Nothing in the application updates or deletes audit rows. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({ data: { ...entry, metadata: entry.metadata ?? undefined } });
}
